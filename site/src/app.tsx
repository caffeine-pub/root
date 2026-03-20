import { MetaProvider } from "@solidjs/meta";
import { Router } from "@solidjs/router";
import { FileRoutes } from "@solidjs/start/router";
import { Suspense } from "solid-js";
import { StyleRegistry } from "solid-styled";
import { GlobalStyles } from "~/ui";

// schibsted grotesk
import "@fontsource/schibsted-grotesk/400.css";
import "@fontsource/schibsted-grotesk/500.css";
import "@fontsource/schibsted-grotesk/600.css";
import "@fontsource/schibsted-grotesk/700.css";
import "@fontsource/schibsted-grotesk/800.css";
import "@fontsource/schibsted-grotesk/900.css";

// ibm plex mono
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";

// fontpie fallback metrics
import "./font-fallbacks.css";

export default function App() {
  return (
    <Router
      root={(props) => (
        <MetaProvider>
          <StyleRegistry auto>
            <GlobalStyles />
            <Suspense>{props.children}</Suspense>
          </StyleRegistry>
        </MetaProvider>
      )}
    >
      <FileRoutes />
    </Router>
  );
}
