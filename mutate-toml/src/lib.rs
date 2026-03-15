use std::ops::Range;
use taplo::dom::node::DomNode;
use taplo::dom::Node;
use taplo::formatter;
use taplo::parser::parse as parse_toml;
use taplo::syntax::SyntaxKind;
use wasm_bindgen::prelude::*;

/// A segment of a key path: either a table key or an array index.
#[derive(Debug, Clone)]
enum PathSegment {
    Key(String),
    Index(usize),
}

/// Parse a path string like "package.dependencies" or "authors[0].name"
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
                    if c == ']' {
                        break;
                    }
                    idx_str.push(c);
                }
                let idx: usize = idx_str
                    .parse()
                    .map_err(|_| format!("invalid array index: {}", idx_str))?;
                segments.push(PathSegment::Index(idx));
            }
            _ => {
                current.push(c);
            }
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

/// Navigate to a node by path segments.
fn resolve_path(root: &Node, segments: &[PathSegment]) -> Option<Node> {
    let mut node = root.clone();
    for seg in segments {
        node = match seg {
            PathSegment::Key(k) => node.get(k.as_str()),
            PathSegment::Index(i) => node.get(*i),
        };
        if node.is_invalid() {
            return None;
        }
    }
    Some(node)
}

/// Navigate to the parent and return (parent_node, last_segment).
fn resolve_parent<'a>(
    root: &Node,
    segments: &'a [PathSegment],
) -> Option<(Node, &'a PathSegment)> {
    if segments.is_empty() {
        return None;
    }
    let parent_path = &segments[..segments.len() - 1];
    let last = &segments[segments.len() - 1];
    if parent_path.is_empty() {
        Some((root.clone(), last))
    } else {
        resolve_path(root, parent_path).map(|parent| (parent, last))
    }
}

/// A text edit: replace range with new text
struct Edit {
    range: Range<usize>,
    replacement: String,
}

#[wasm_bindgen]
pub struct TomlEditor {
    source: String,
    root: Node,
    edits: Vec<Edit>,
}

/// Get the full text range of an ENTRY node (key = value) including any leading whitespace.
/// Walks up from a value node to find the enclosing ENTRY.
fn entry_range(node: &Node, source: &str) -> Option<Range<usize>> {
    let syntax = node.syntax()?;
    let mut current = syntax.clone();
    loop {
        let parent = match &current {
            rowan::NodeOrToken::Node(n) => n.parent(),
            rowan::NodeOrToken::Token(t) => t.parent(),
        };
        if let Some(p) = parent {
            if p.kind() == SyntaxKind::ENTRY {
                let range = p.text_range();
                let start = usize::from(range.start());
                let mut end = usize::from(range.end());
                // include trailing newline
                if end < source.len() && source.as_bytes()[end] == b'\n' {
                    end += 1;
                }
                return Some(start..end);
            }
            current = rowan::NodeOrToken::Node(p);
        } else {
            break;
        }
    }
    None
}

/// Get the value-only text range of a node (not the key, just the value).
fn value_range(node: &Node) -> Option<Range<usize>> {
    // for a table node, text_ranges returns all ranges including children
    // for a scalar, it returns just the value
    let ranges: Vec<_> = node.text_ranges().collect();
    if ranges.is_empty() {
        return None;
    }
    // use the first range for scalar values
    let range = &ranges[0];
    Some(usize::from(range.start())..usize::from(range.end()))
}

/// Find the text range of an array element at a given index.
fn array_element_range(array_node: &Node, index: usize, source: &str) -> Option<Range<usize>> {
    let arr = array_node.as_array()?;
    let items = arr.items().read();
    let item = items.get(index)?;

    // for table arrays ([[thing]]), the entry is a full section
    // for inline arrays, it's just the element
    if let Some(syntax) = item.syntax() {
        let range = match syntax {
            rowan::NodeOrToken::Node(n) => n.text_range(),
            rowan::NodeOrToken::Token(t) => t.text_range(),
        };
        let mut start = usize::from(range.start());
        let mut end = usize::from(range.end());

        // try to include surrounding comma/whitespace for inline arrays
        // look backwards for comma
        let before = &source[..start];
        if let Some(comma_pos) = before.rfind(',') {
            // check there's only whitespace between comma and start
            if source[comma_pos + 1..start].trim().is_empty() {
                start = comma_pos;
            }
        }

        // or look forward for comma
        let after = &source[end..];
        if let Some(comma_offset) = after.find(',') {
            if source[end..end + comma_offset].trim().is_empty() {
                end = end + comma_offset + 1;
                // also eat trailing whitespace
                while end < source.len() && source.as_bytes()[end] == b' ' {
                    end += 1;
                }
            }
        }

        return Some(start..end);
    }

    None
}

#[wasm_bindgen]
impl TomlEditor {
    /// Parse a TOML string and return an editor for it.
    #[wasm_bindgen(constructor)]
    pub fn new(source: &str) -> Result<TomlEditor, JsError> {
        let parsed = parse_toml(source);

        if !parsed.errors.is_empty() {
            return Err(JsError::new(&format!(
                "TOML parse error: {}",
                parsed.errors[0]
            )));
        }

        let root = parsed.into_dom();

        Ok(TomlEditor {
            source: source.to_string(),
            root,
            edits: Vec::new(),
        })
    }

    /// Set a value at a path. Creates intermediate tables if needed.
    /// Value should be a valid TOML value string (e.g. `"1.3.1"` with quotes for strings).
    pub fn set(&mut self, path: &str, value: &str) -> Result<(), JsError> {
        let segments = parse_path(path).map_err(|e| JsError::new(&e))?;

        // try to find existing node
        if let Some(existing) = resolve_path(&self.root, &segments) {
            if let Some(range) = value_range(&existing) {
                self.edits.push(Edit {
                    range,
                    replacement: value.to_string(),
                });
                return Ok(());
            }
        }

        // node doesn't exist — insert
        self.insert_new_entry(&segments, value)
    }

    /// Remove a key-value entry or array element at a path.
    pub fn remove(&mut self, path: &str) -> Result<(), JsError> {
        let segments = parse_path(path).map_err(|e| JsError::new(&e))?;

        let node = resolve_path(&self.root, &segments)
            .ok_or_else(|| JsError::new(&format!("not found: {}", path)))?;

        // check if the last segment is an array index — if so, use array element removal
        if let Some(PathSegment::Index(idx)) = segments.last() {
            if let Some((parent, _)) = resolve_parent(&self.root, &segments) {
                if let Some(range) = array_element_range(&parent, *idx, &self.source) {
                    self.edits.push(Edit {
                        range,
                        replacement: String::new(),
                    });
                    return Ok(());
                }
            }
        }

        // for table entries, walk up to the ENTRY syntax node
        if let Some(range) = entry_range(&node, &self.source) {
            self.edits.push(Edit {
                range,
                replacement: String::new(),
            });
            return Ok(());
        }

        // fallback
        let ranges: Vec<_> = node.text_ranges().collect();
        for range in ranges.iter().rev() {
            self.edits.push(Edit {
                range: usize::from(range.start())..usize::from(range.end()),
                replacement: String::new(),
            });
        }

        Ok(())
    }

    /// Insert a value into an array at a given index.
    /// Path should point to the array, e.g. "packages" or "package.authors".
    pub fn insert(&mut self, path: &str, index: usize, value: &str) -> Result<(), JsError> {
        let segments = parse_path(path).map_err(|e| JsError::new(&e))?;

        let array_node = resolve_path(&self.root, &segments)
            .ok_or_else(|| JsError::new(&format!("array not found: {}", path)))?;

        let arr = array_node
            .as_array()
            .ok_or_else(|| JsError::new(&format!("not an array: {}", path)))?;

        let items = arr.items().read();
        let len = items.len();

        if index > len {
            return Err(JsError::new(&format!(
                "index {} out of bounds for array of length {}",
                index, len
            )));
        }

        if len == 0 {
            // empty array — find the `[]` and insert inside it
            if let Some(syntax) = array_node.syntax() {
                let text = match syntax {
                    rowan::NodeOrToken::Node(n) => n.text_range(),
                    rowan::NodeOrToken::Token(t) => t.text_range(),
                };
                let start = usize::from(text.start());
                let end = usize::from(text.end());
                // replace `[]` with `[value]`
                self.edits.push(Edit {
                    range: start..end,
                    replacement: format!("[{}]", value),
                });
            }
        } else if index == len {
            // append after last element
            let last = &items[len - 1];
            if let Some(syntax) = last.syntax() {
                let range = match syntax {
                    rowan::NodeOrToken::Node(n) => n.text_range(),
                    rowan::NodeOrToken::Token(t) => t.text_range(),
                };
                let end = usize::from(range.end());
                self.edits.push(Edit {
                    range: end..end,
                    replacement: format!(", {}", value),
                });
            }
        } else {
            // insert before element at index
            let target = &items[index];
            if let Some(syntax) = target.syntax() {
                let range = match syntax {
                    rowan::NodeOrToken::Node(n) => n.text_range(),
                    rowan::NodeOrToken::Token(t) => t.text_range(),
                };
                let start = usize::from(range.start());
                self.edits.push(Edit {
                    range: start..start,
                    replacement: format!("{}, ", value),
                });
            }
        }

        Ok(())
    }

    /// Remove an element from an array at a given index.
    /// Path should point to the array.
    pub fn remove_at(&mut self, path: &str, index: usize) -> Result<(), JsError> {
        let segments = parse_path(path).map_err(|e| JsError::new(&e))?;

        let array_node = resolve_path(&self.root, &segments)
            .ok_or_else(|| JsError::new(&format!("array not found: {}", path)))?;

        let arr = array_node
            .as_array()
            .ok_or_else(|| JsError::new(&format!("not an array: {}", path)))?;

        let items = arr.items().read();
        if index >= items.len() {
            return Err(JsError::new(&format!(
                "index {} out of bounds for array of length {}",
                index,
                items.len()
            )));
        }

        if let Some(range) = array_element_range(&array_node, index, &self.source) {
            self.edits.push(Edit {
                range,
                replacement: String::new(),
            });
        }

        Ok(())
    }

    /// Apply all edits, format with taplo, return the result.
    pub fn finish(mut self) -> Result<String, JsError> {
        // sort edits by range start descending — apply from end to start
        self.edits
            .sort_by(|a, b| b.range.start.cmp(&a.range.start));

        let mut result = self.source.clone();

        for edit in &self.edits {
            result.replace_range(edit.range.clone(), &edit.replacement);
        }

        // format with taplo
        let formatted = formatter::format(&result, formatter::Options::default());
        Ok(formatted)
    }
}

impl TomlEditor {
    /// Insert a new key = value entry, creating tables as needed.
    fn insert_new_entry(&mut self, segments: &[PathSegment], value: &str) -> Result<(), JsError> {
        // split into table path (all Key segments before the last Key) and the final key
        let mut table_segments = Vec::new();
        let mut final_key = None;

        for (i, seg) in segments.iter().enumerate().rev() {
            if let PathSegment::Key(k) = seg {
                final_key = Some(k.as_str());
                table_segments = segments[..i].to_vec();
                break;
            }
        }

        let final_key =
            final_key.ok_or_else(|| JsError::new("path must end with a key for insertion"))?;

        if table_segments.is_empty() {
            // top-level key
            let entry = format!("{} = {}\n", final_key, value);
            self.edits.push(Edit {
                range: self.source.len()..self.source.len(),
                replacement: entry,
            });
            return Ok(());
        }

        // try to find the parent table
        if let Some(table_node) = resolve_path(&self.root, &table_segments) {
            let ranges: Vec<_> = table_node.text_ranges().collect();
            if let Some(last_range) = ranges.last() {
                let end = usize::from(last_range.end());
                let insert_pos = self.source[end..]
                    .find('\n')
                    .map(|i| end + i + 1)
                    .unwrap_or(self.source.len());

                let entry = format!("{} = {}\n", final_key, value);
                self.edits.push(Edit {
                    range: insert_pos..insert_pos,
                    replacement: entry,
                });
                return Ok(());
            }
        }

        // table doesn't exist — create header
        let table_key: String = table_segments
            .iter()
            .filter_map(|s| match s {
                PathSegment::Key(k) => Some(k.as_str()),
                _ => None,
            })
            .collect::<Vec<_>>()
            .join(".");

        let header = format!("\n[{}]\n{} = {}\n", table_key, final_key, value);
        self.edits.push(Edit {
            range: self.source.len()..self.source.len(),
            replacement: header,
        });

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn set_existing_value() {
        let toml = "[package]\nname = \"test\"\nversion = \"0.1.0\"\n";
        let mut editor = TomlEditor::new(toml).unwrap();
        editor.set("package.version", "\"0.2.0\"").unwrap();
        let result = editor.finish().unwrap();
        assert!(result.contains("version = \"0.2.0\""), "got: {}", result);
        assert!(result.contains("name = \"test\""), "got: {}", result);
    }

    #[test]
    fn insert_new_key() {
        let toml = "[package]\nname = \"test\"\n";
        let mut editor = TomlEditor::new(toml).unwrap();
        editor.set("package.description", "\"a thing\"").unwrap();
        let result = editor.finish().unwrap();
        assert!(
            result.contains("description = \"a thing\""),
            "got: {}",
            result
        );
        assert!(result.contains("name = \"test\""), "got: {}", result);
    }

    #[test]
    fn insert_new_table() {
        let toml = "[package]\nname = \"test\"\n";
        let mut editor = TomlEditor::new(toml).unwrap();
        editor.set("dependencies.serde", "\"1.0\"").unwrap();
        let result = editor.finish().unwrap();
        assert!(result.contains("[dependencies]"), "got: {}", result);
        assert!(result.contains("serde = \"1.0\""), "got: {}", result);
    }

    #[test]
    fn remove_key() {
        let toml = "[package]\nname = \"test\"\nversion = \"0.1.0\"\n";
        let mut editor = TomlEditor::new(toml).unwrap();
        editor.remove("package.version").unwrap();
        let result = editor.finish().unwrap();
        assert!(!result.contains("version"), "got: {}", result);
        assert!(result.contains("name = \"test\""), "got: {}", result);
    }

    #[test]
    fn insert_into_array() {
        let toml = "items = [1, 2, 3]\n";
        let mut editor = TomlEditor::new(toml).unwrap();
        editor.insert("items", 1, "99").unwrap();
        let result = editor.finish().unwrap();
        assert!(
            result.contains("99") && result.contains("1"),
            "got: {}",
            result
        );
    }

    #[test]
    fn append_to_array() {
        let toml = "items = [1, 2, 3]\n";
        let mut editor = TomlEditor::new(toml).unwrap();
        editor.insert("items", 3, "4").unwrap();
        let result = editor.finish().unwrap();
        assert!(result.contains("4"), "got: {}", result);
    }

    #[test]
    fn remove_from_array() {
        let toml = "items = [1, 2, 3]\n";
        let mut editor = TomlEditor::new(toml).unwrap();
        editor.remove_at("items", 1).unwrap();
        let result = editor.finish().unwrap();
        assert!(result.contains("1"), "got: {}", result);
        assert!(result.contains("3"), "got: {}", result);
        assert!(!result.contains("2"), "got: {}", result);
    }
}
