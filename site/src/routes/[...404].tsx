import { Title } from "@solidjs/meta";
import { HttpStatusCode } from "@solidjs/start";
import { useLocation } from "@solidjs/router";
import { css } from "solid-styled";
import { Nav, Text, Code, Link } from "~/ui";

export default function NotFound() {
  const location = useLocation();

  css`
    div.page {
      max-width: 480px;
      margin: 0 auto;
      padding: 2.5rem 2rem;
      width: 100%;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
    }

    div.page nav {
      margin-bottom: 0;
    }

    div.center {
      margin: auto 0;
      padding: 3rem 0;
    }

    div.center p {
      margin-bottom: 1.8rem;
      max-width: 360px;
    }

    div.label {
      margin-bottom: 0.8rem;
    }

    div.heading {
      margin-bottom: 0.8rem;
    }

    div.links {
      display: flex;
      gap: 0.5rem;
      flex-wrap: wrap;
      align-items: center;
    }
  `;

  return (
    <div class="page">
      <Title>404 / caffeine.pub</Title>
      <HttpStatusCode code={404} />
      <Nav noMargin />

      <div class="center">
        <div class="label">
          <Text variant="label">404 . not found</Text>
        </div>
        <div class="heading">
          <Text variant="heading">nothing here</Text>
        </div>
        <p>
          <Text variant="body">
            Whatever was at <Code>{location.pathname}</Code> either moved, never
            existed, or got dropped with a dangling reference.
          </Text>
        </p>
        <div class="links">
          <Link href="/" variant="button">
            go home
          </Link>
          <Link href="/roadmap" variant="nav">
            roadmap
          </Link>
        </div>
      </div>
    </div>
  );
}
