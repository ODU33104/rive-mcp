# Studio Agent: direct model connection

## Scope

The initial implementation supports conversation and read-only
access to the current document specification.

Existing MCP-based Studio notes and replies remain supported.

Direct model connection is disabled by default.

## Trust boundaries

- The browser authenticates with the existing Studio server.
- The Studio server owns provider credentials in process memory.
- Provider credentials are never returned by configuration APIs.
- Credentials must not enter logs, errors, URLs, or persisted files.
- The share server must reject every Agent API route.
- Documents and provider responses are untrusted data.
- The model has no independent filesystem or execution access.

## Network policy

- Only explicitly configured destinations are permitted.
- URL credentials, queries, and fragments are forbidden.
- HTTP requires an explicit warning outside loopback.
- Redirects are forbidden.
- DNS resolution must be checked before outbound requests.
- Requests have time, body, and output size limits.
- Provider error bodies are not forwarded to the browser.
- Outbound requests must not be attempted while disabled.

## Future editing interface

The editing interface is separate from conversation.

Initial permitted operation:

    riv_edit.set

Required fields:

    objectIndex
    propertyName
    value

The server must validate the object, property, type,
and value against the currently loaded document.

The model must not select arbitrary filesystem paths.

The UI must show an operation preview before execution.

## Checkpoints

Before each approved edit:

1. Read the current .riv bytes.
2. Record the document hash and current revision.
3. Store a session-scoped checkpoint.
4. Verify that the target revision has not changed.
5. Validate and apply the requested edit.
6. Validate the resulting document.
7. On failure, restore the previous bytes.
8. Expose an explicit Restore action in Studio.

Checkpoint restoration must reject concurrent conflicting edits.

Checkpoint storage must be bounded and cleaned on session close.

## Acceptance gates

- Build and TypeScript checks pass.
- All eight i18n dictionaries contain the same new keys.
- No secrets appear in API responses or diagnostic output.
- The share viewer cannot configure or invoke Agent routes.
- Redirects and unsupported URL schemes are rejected.
- The existing MCP conversation remains functional.
- Provider protocol tests pass.
- Model-driven editing remains unavailable until checkpoint
  and approval tests are implemented.
