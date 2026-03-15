use std::ops::Range;
use rowan::TextRange;
use taplo::dom::node::DomNode;
use taplo::dom::Node;
use taplo::formatter;
use taplo::parser::parse as parse_toml;
use taplo::syntax::{SyntaxElement, SyntaxKind, SyntaxNode};
use wasm_bindgen::prelude::*;

// ── path parsing ──────────────────────────────────────────────

#[derive(Debug, Clone)]
enum PathSegment {
    Key(String),
    Index(usize),
}

fn parse_path(path: &str) -> Result<Vec<PathSegment>, String> {
    let mut segments = Vec::new();
    let mut current = String::new();
    let mut chars = path.chars().peekable();

    while let Some(c) = chars.next() {
        match c {
            '.' => {
                if !current.is_empty() {
                    segments.push(PathSegment::Key(current.clone()));
                    current.clear();
                }
            }
            '[' => {
                if !current.is_empty() {
                    segments.push(PathSegment::Key(current.clone()));
                    current.clear();
                }
                let mut idx_str = String::new();
                for c in chars.by_ref() {
                    if c == ']' { break; }
                    idx_str.push(c);
                }
                let idx: usize = idx_str.parse()
                    .map_err(|_| format!("invalid array index: {}", idx_str))?;
                segments.push(PathSegment::Index(idx));
            }
            _ => current.push(c),
        }
    }
    if !current.is_empty() {
        segments.push(PathSegment::Key(current));
    }
    if segments.is_empty() {
        return Err("empty path".to_string());
    }
    Ok(segments)
}

fn resolve_path(root: &Node, segments: &[PathSegment]) -> Option<Node> {
    let mut node = root.clone();
    for seg in segments {
        node = match seg {
            PathSegment::Key(k) => node.get(k.as_str()),
            PathSegment::Index(i) => node.get(*i),
        };
        if node.is_invalid() { return None; }
    }
    Some(node)
}

// ── CST helpers ───────────────────────────────────────────────

fn text_range_to_std(range: TextRange) -> Range<usize> {
    usize::from(range.start())..usize::from(range.end())
}

/// Walk up from a syntax element to find an ancestor of a given kind.
fn find_ancestor(elem: &SyntaxElement, kind: SyntaxKind) -> Option<SyntaxNode> {
    let mut current = elem.clone();
    loop {
        let parent = match &current {
            rowan::NodeOrToken::Node(n) => n.parent(),
            rowan::NodeOrToken::Token(t) => t.parent(),
        };
        match parent {
            Some(p) if p.kind() == kind => return Some(p),
            Some(p) => current = rowan::NodeOrToken::Node(p),
            None => return None,
        }
    }
}

/// Collect the range of an ENTRY node plus its trailing NEWLINE sibling.
fn entry_full_range(entry: &SyntaxNode) -> Range<usize> {
    let start = usize::from(entry.text_range().start());
    let mut end = usize::from(entry.text_range().end());

    // check next sibling for NEWLINE
    if let Some(next) = entry.next_sibling_or_token() {
        if next.kind() == SyntaxKind::NEWLINE {
            end = usize::from(next.text_range().end());
        }
    }

    start..end
}

/// Given an ARRAY syntax node and a child VALUE index, compute the range
/// to remove including the adjacent comma and whitespace.
///
/// CST structure: BRACKET_START, VALUE, COMMA, WS, VALUE, COMMA, WS, VALUE, BRACKET_END
fn array_element_removal_range(
    array_syntax: &SyntaxNode,
    value_index: usize,
) -> Option<Range<usize>> {
    // collect VALUE children
    let values: Vec<SyntaxElement> = array_syntax
        .children_with_tokens()
        .filter(|c| c.kind() == SyntaxKind::VALUE)
        .collect();

    let len = values.len();
    let target = values.get(value_index)?;
    let target_range = target.text_range();

    if len == 1 {
        // only element — just remove the value, leave []
        return Some(text_range_to_std(target_range));
    }

    let mut start = usize::from(target_range.start());
    let mut end = usize::from(target_range.end());

    if value_index < len - 1 {
        // not the last: eat forward — COMMA and WHITESPACE after this VALUE
        let mut sib = target.next_sibling_or_token();
        while let Some(s) = &sib {
            match s.kind() {
                SyntaxKind::COMMA | SyntaxKind::WHITESPACE | SyntaxKind::NEWLINE => {
                    end = usize::from(s.text_range().end());
                    sib = s.next_sibling_or_token();
                }
                _ => break,
            }
        }
    } else {
        // last element: eat backward — WHITESPACE and COMMA before this VALUE
        let mut sib = target.prev_sibling_or_token();
        while let Some(s) = &sib {
            match s.kind() {
                SyntaxKind::COMMA | SyntaxKind::WHITESPACE | SyntaxKind::NEWLINE => {
                    start = usize::from(s.text_range().start());
                    sib = s.prev_sibling_or_token();
                }
                _ => break,
            }
        }
    }

    Some(start..end)
}

/// Given an ARRAY syntax node, find the insertion point and separator for a new
/// element at the given index.
fn array_element_insertion(
    array_syntax: &SyntaxNode,
    index: usize,
) -> Option<(usize, String)> {
    let values: Vec<SyntaxElement> = array_syntax
        .children_with_tokens()
        .filter(|c| c.kind() == SyntaxKind::VALUE)
        .collect();

    let len = values.len();

    if len == 0 {
        // empty array — insert after BRACKET_START
        let bracket = array_syntax
            .children_with_tokens()
            .find(|c| c.kind() == SyntaxKind::BRACKET_START)?;
        let pos = usize::from(bracket.text_range().end());
        return Some((pos, String::new()));
    }

    if index >= len {
        // append after last element
        let last = values.last()?;
        let pos = usize::from(last.text_range().end());
        return Some((pos, ", ".to_string()));
    }

    // insert before element at index
    let target = &values[index];
    let pos = usize::from(target.text_range().start());
    Some((pos, String::new()))
}

// ── edits ─────────────────────────────────────────────────────

struct Edit {
    range: Range<usize>,
    replacement: String,
}

// ── main API ──────────────────────────────────────────────────

#[wasm_bindgen]
pub struct TomlEditor {
    source: String,
    root: Node,
    cst: SyntaxNode,
    edits: Vec<Edit>,
}

#[wasm_bindgen]
impl TomlEditor {
    #[wasm_bindgen(constructor)]
    pub fn new(source: &str) -> Result<TomlEditor, JsError> {
        let parsed = parse_toml(source);
        if !parsed.errors.is_empty() {
            return Err(JsError::new(&format!("TOML parse error: {}", parsed.errors[0])));
        }
        let cst = SyntaxNode::new_root(parsed.green_node.clone());
        let root = parsed.into_dom();

        Ok(TomlEditor { source: source.to_string(), root, cst, edits: Vec::new() })
    }

    /// Set a value at a path. Creates intermediate tables if needed.
    pub fn set(&mut self, path: &str, value: &str) -> Result<(), JsError> {
        let segments = parse_path(path).map_err(|e| JsError::new(&e))?;

        if let Some(existing) = resolve_path(&self.root, &segments) {
            // replace the existing value's range
            let ranges: Vec<_> = existing.text_ranges().collect();
            if let Some(range) = ranges.first() {
                self.edits.push(Edit {
                    range: text_range_to_std(*range),
                    replacement: value.to_string(),
                });
                return Ok(());
            }
        }

        self.insert_new_entry(&segments, value)
    }

    /// Remove a key-value entry at a path.
    pub fn remove(&mut self, path: &str) -> Result<(), JsError> {
        let segments = parse_path(path).map_err(|e| JsError::new(&e))?;

        let node = resolve_path(&self.root, &segments)
            .ok_or_else(|| JsError::new(&format!("not found: {}", path)))?;

        // if last segment is array index, delegate to remove_at
        if let Some(PathSegment::Index(idx)) = segments.last() {
            let parent_segments = &segments[..segments.len() - 1];
            let parent = if parent_segments.is_empty() {
                self.root.clone()
            } else {
                resolve_path(&self.root, parent_segments)
                    .ok_or_else(|| JsError::new("parent not found"))?
            };

            if let Some(arr) = parent.as_array() {
                if let Some(syntax) = parent.syntax() {
                    let array_syntax = match syntax {
                        rowan::NodeOrToken::Node(n) => n.clone(),
                        rowan::NodeOrToken::Token(t) => t.parent().ok_or_else(|| JsError::new("no parent"))?,
                    };
                    // find the ARRAY node in the CST
                    let array_cst = if array_syntax.kind() == SyntaxKind::ARRAY {
                        array_syntax
                    } else {
                        find_ancestor(&syntax, SyntaxKind::ARRAY)
                            .ok_or_else(|| JsError::new("can't find ARRAY in CST"))?
                    };

                    if let Some(range) = array_element_removal_range(&array_cst, *idx) {
                        self.edits.push(Edit { range, replacement: String::new() });
                        return Ok(());
                    }
                }
            }
        }

        // table entry — walk up to ENTRY node
        if let Some(syntax) = node.syntax() {
            if let Some(entry) = find_ancestor(syntax, SyntaxKind::ENTRY) {
                self.edits.push(Edit {
                    range: entry_full_range(&entry),
                    replacement: String::new(),
                });
                return Ok(());
            }
        }

        Err(JsError::new(&format!("couldn't determine removal range for: {}", path)))
    }

    /// Insert a value into an array at a given index.
    pub fn insert(&mut self, path: &str, index: usize, value: &str) -> Result<(), JsError> {
        let segments = parse_path(path).map_err(|e| JsError::new(&e))?;

        let array_node = resolve_path(&self.root, &segments)
            .ok_or_else(|| JsError::new(&format!("not found: {}", path)))?;

        let arr = array_node.as_array()
            .ok_or_else(|| JsError::new(&format!("not an array: {}", path)))?;

        let items = arr.items().read();
        let len = items.len();

        if index > len {
            return Err(JsError::new(&format!(
                "index {} out of bounds for array of length {}", index, len
            )));
        }

        // find the ARRAY syntax node
        let syntax = array_node.syntax()
            .ok_or_else(|| JsError::new("no syntax for array"))?;
        let array_cst = if syntax.kind() == SyntaxKind::ARRAY {
            match syntax {
                rowan::NodeOrToken::Node(n) => n.clone(),
                _ => return Err(JsError::new("expected node")),
            }
        } else {
            find_ancestor(syntax, SyntaxKind::ARRAY)
                .ok_or_else(|| JsError::new("can't find ARRAY in CST"))?
        };

        let (pos, prefix) = array_element_insertion(&array_cst, index)
            .ok_or_else(|| JsError::new("couldn't find insertion point"))?;

        let suffix = if index < len && len > 0 { ", " } else { "" };
        let replacement = format!("{}{}{}", prefix, value, suffix);

        self.edits.push(Edit {
            range: pos..pos,
            replacement,
        });

        Ok(())
    }

    /// Remove an element from an array at a given index.
    pub fn remove_at(&mut self, path: &str, index: usize) -> Result<(), JsError> {
        let segments = parse_path(path).map_err(|e| JsError::new(&e))?;

        let array_node = resolve_path(&self.root, &segments)
            .ok_or_else(|| JsError::new(&format!("not found: {}", path)))?;

        let arr = array_node.as_array()
            .ok_or_else(|| JsError::new(&format!("not an array: {}", path)))?;

        let items = arr.items().read();
        if index >= items.len() {
            return Err(JsError::new(&format!(
                "index {} out of bounds for array of length {}", index, items.len()
            )));
        }

        let syntax = array_node.syntax()
            .ok_or_else(|| JsError::new("no syntax for array"))?;
        let array_cst = if syntax.kind() == SyntaxKind::ARRAY {
            match syntax {
                rowan::NodeOrToken::Node(n) => n.clone(),
                _ => return Err(JsError::new("expected node")),
            }
        } else {
            find_ancestor(syntax, SyntaxKind::ARRAY)
                .ok_or_else(|| JsError::new("can't find ARRAY in CST"))?
        };

        let range = array_element_removal_range(&array_cst, index)
            .ok_or_else(|| JsError::new("couldn't determine removal range"))?;

        self.edits.push(Edit { range, replacement: String::new() });
        Ok(())
    }

    /// Apply all edits, format with taplo, return the result.
    pub fn finish(mut self) -> Result<String, JsError> {
        self.edits.sort_by(|a, b| b.range.start.cmp(&a.range.start));
        let mut result = self.source.clone();
        for edit in &self.edits {
            result.replace_range(edit.range.clone(), &edit.replacement);
        }
        let formatted = formatter::format(&result, formatter::Options::default());
        Ok(formatted)
    }
}

impl TomlEditor {
    fn insert_new_entry(&mut self, segments: &[PathSegment], value: &str) -> Result<(), JsError> {
        let mut table_segments = Vec::new();
        let mut final_key = None;

        for (i, seg) in segments.iter().enumerate().rev() {
            if let PathSegment::Key(k) = seg {
                final_key = Some(k.as_str());
                table_segments = segments[..i].to_vec();
                break;
            }
        }

        let final_key = final_key
            .ok_or_else(|| JsError::new("path must end with a key for insertion"))?;

        if table_segments.is_empty() {
            // top-level key
            self.edits.push(Edit {
                range: self.source.len()..self.source.len(),
                replacement: format!("{} = {}\n", final_key, value),
            });
            return Ok(());
        }

        if let Some(table_node) = resolve_path(&self.root, &table_segments) {
            // find the last child entry's NEWLINE to insert after
            let ranges: Vec<_> = table_node.text_ranges().collect();
            if let Some(last_range) = ranges.last() {
                let end = usize::from(last_range.end());
                // find end of the line containing this range
                let insert_pos = self.source[end..]
                    .find('\n')
                    .map(|i| end + i + 1)
                    .unwrap_or(self.source.len());

                self.edits.push(Edit {
                    range: insert_pos..insert_pos,
                    replacement: format!("{} = {}\n", final_key, value),
                });
                return Ok(());
            }
        }

        // create new table
        let table_key: String = table_segments.iter()
            .filter_map(|s| match s {
                PathSegment::Key(k) => Some(k.as_str()),
                _ => None,
            })
            .collect::<Vec<_>>()
            .join(".");

        self.edits.push(Edit {
            range: self.source.len()..self.source.len(),
            replacement: format!("\n[{}]\n{} = {}\n", table_key, final_key, value),
        });

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use insta::assert_snapshot;

    #[test]
    fn set_existing_value() {
        let toml = "[package]\nname = \"test\"\nversion = \"0.1.0\"\n";
        let mut editor = TomlEditor::new(toml).unwrap();
        editor.set("package.version", "\"0.2.0\"").unwrap();
        assert_snapshot!(editor.finish().unwrap());
    }

    #[test]
    fn insert_new_key() {
        let toml = "[package]\nname = \"test\"\n";
        let mut editor = TomlEditor::new(toml).unwrap();
        editor.set("package.description", "\"a thing\"").unwrap();
        assert_snapshot!(editor.finish().unwrap());
    }

    #[test]
    fn insert_new_table() {
        let toml = "[package]\nname = \"test\"\n";
        let mut editor = TomlEditor::new(toml).unwrap();
        editor.set("dependencies.serde", "\"1.0\"").unwrap();
        assert_snapshot!(editor.finish().unwrap());
    }

    #[test]
    fn remove_key() {
        let toml = "[package]\nname = \"test\"\nversion = \"0.1.0\"\n";
        let mut editor = TomlEditor::new(toml).unwrap();
        editor.remove("package.version").unwrap();
        assert_snapshot!(editor.finish().unwrap());
    }

    #[test]
    fn insert_into_array() {
        let toml = "items = [1, 2, 3]\n";
        let mut editor = TomlEditor::new(toml).unwrap();
        editor.insert("items", 1, "99").unwrap();
        assert_snapshot!(editor.finish().unwrap());
    }

    #[test]
    fn append_to_array() {
        let toml = "items = [1, 2, 3]\n";
        let mut editor = TomlEditor::new(toml).unwrap();
        editor.insert("items", 3, "4").unwrap();
        assert_snapshot!(editor.finish().unwrap());
    }

    #[test]
    fn remove_from_array() {
        let toml = "items = [1, 2, 3]\n";
        let mut editor = TomlEditor::new(toml).unwrap();
        editor.remove_at("items", 1).unwrap();
        assert_snapshot!(editor.finish().unwrap());
    }

    #[test]
    fn remove_first_from_array() {
        let toml = "items = [1, 2, 3]\n";
        let mut editor = TomlEditor::new(toml).unwrap();
        editor.remove_at("items", 0).unwrap();
        assert_snapshot!(editor.finish().unwrap());
    }

    #[test]
    fn remove_last_from_array() {
        let toml = "items = [1, 2, 3]\n";
        let mut editor = TomlEditor::new(toml).unwrap();
        editor.remove_at("items", 2).unwrap();
        assert_snapshot!(editor.finish().unwrap());
    }

    #[test]
    fn remove_only_element() {
        let toml = "items = [42]\n";
        let mut editor = TomlEditor::new(toml).unwrap();
        editor.remove_at("items", 0).unwrap();
        assert_snapshot!(editor.finish().unwrap());
    }
}
