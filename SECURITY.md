# Security

## Reporting

Please report security problems by opening an issue at https://github.com/ODU33104/rive-mcp/issues (leave out anything exploitable until it is fixed, and say you have details to share).

## What the editable Studio does (`riv_studio`)

- It listens on `127.0.0.1` only. The optional read-only LAN view is a separate port with its own token.
- Every request needs a random per-session credential. `riv_studio` returns a link with the credential in the URL fragment; opening it exchanges it for an `HttpOnly`, `SameSite=Strict` cookie and removes it from the address bar. Restarting the Studio invalidates earlier links. Anyone holding the link can edit the open file, so do not share it.
- Host, `Origin` and `Sec-Fetch-Site` are checked, so a web page you happen to have open cannot send edits to the local Studio (DNS rebinding and cross-site requests are refused). Only `GET` and `POST` are accepted.
- Request bodies are capped at 16 MiB, and header/request timeouts are set.
- The page is served with a Content-Security-Policy that blocks outbound connections and framing. Inline scripts are still allowed because the Studio UI uses them, so this limits exfiltration and embedding but is not an XSS defence.

This is defence in depth for a local tool, not an operating-system sandbox. Other programs running as your OS user, browser extensions and the MCP host itself are outside this boundary.
