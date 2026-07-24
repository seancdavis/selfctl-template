# selfctl agent starter

A minimal, deployable, protocol-conformant **selfctl agent** — a Netlify site
that implements the selfctl agent protocol over HTTP. Fork it, deploy it, and
you have a running agent in minutes.

The turn logic is **stubbed today** (no LLM): every `POST /message`
deterministically appends `turn.started`, proposes a `reference.note` from
the raw text, appends `proposal.created`, then `turn.finished`. Approving (or
overriding) the proposal writes a row to the `notes` table — the only domain
write this starter knows how to make. The point of this stub is to prove the
protocol loop — message → cursored event log → human decision on a proposal —
end to end before the real agent core (an LLM-backed turn) lands in a later
phase.

## Deploy

[![Deploy to Netlify](https://www.netlify.com/img/deploy/button.svg)](https://app.netlify.com/start/deploy?repository=https://github.com/seancdavis/selfctl-template)

1. Click the button above.
2. When prompted, set `AGENT_ADMIN_KEY` to a long, random value — this is the
   deploy-time root secret for your agent. Only you (the deployer) should
   know it.
3. Once the deploy finishes, open the deployed site.
4. Enter your admin key in the **Unlock** form and click **Unlock** — this
   reveals the connection token.
5. Copy the connection token and hand it to whatever client will talk to the
   agent (e.g. a desktop app), or use it directly as the bearer token for the
   protocol endpoints below.

`@netlify/database` auto-provisions a Postgres database and applies the
migrations in `netlify/database/migrations` at deploy time — no manual DB
setup required.

## Auth: admin key vs. connection token

This agent uses the framework's two-tier auth model:

- **`AGENT_ADMIN_KEY`** — a deploy-time root secret, set as a site environment
  variable. Only the deployer knows it. It gates `/config/*` and can also be
  used anywhere a connection token is accepted (the admin can do anything).
- **Connection token** — minted once on first use, stored in the `config`
  table. This is the bearer clients (like a desktop app) actually use against
  the protocol endpoints (`/message`, `/events`, `/proposals/:id/decision`,
  `/summary`). It's never printed to logs or config files — the only way to
  see it is through the admin-gated UI.

## Run it locally

```bash
netlify dev
```

Set `AGENT_ADMIN_KEY` in the site's environment (or a local `.env`) before
starting.

## Using the UI

Visit the site (locally: `http://localhost:8888`). Enter the admin key and
click **Unlock** to reveal the connection token, with a copy button. A
**Recent activity** panel lets you fetch and read the event log without a
terminal.

## Example curl loop

Set a couple of shell variables first:

```bash
export BASE_URL=http://localhost:8888
export AGENT_ADMIN_KEY=dev-admin-key
```

**1. Fetch the connection token (admin key required):**

```bash
curl -s "$BASE_URL/config/token" \
  -H "Authorization: Bearer $AGENT_ADMIN_KEY"
```

Save it for the rest of the loop:

```bash
export CONNECTION_TOKEN=<connectionToken from the response above>
```

**2. Send a message — starts a turn, returns a `turnId`:**

```bash
curl -s -X POST "$BASE_URL/message" \
  -H "Authorization: Bearer $CONNECTION_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"text": "remember that the deploy key rotates on the 1st"}'
```

**3. Poll the event log — watch the turn run and grab the proposal:**

```bash
curl -s "$BASE_URL/events?since=0" \
  -H "Authorization: Bearer $CONNECTION_TOKEN"
```

**4. Decide the proposal — approve it (use the `id` from the `proposal.created`
event above):**

```bash
curl -s -X POST "$BASE_URL/proposals/<proposal-id>/decision" \
  -H "Authorization: Bearer $CONNECTION_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"verb": "approve"}'
```

**5. Check the agent's identity + capabilities:**

```bash
curl -s "$BASE_URL/summary" \
  -H "Authorization: Bearer $CONNECTION_TOKEN"
```

`AGENT_ADMIN_KEY` also works as the bearer for steps 2–5, since the admin can
do anything a client can.

## Fork & customize

This repo is a starting point, not a finished product. Fork it, rename the
agent identity in `netlify/functions/_shared/agent.ts`, and start wiring in
real turn logic where `netlify/functions/message.ts` currently stubs one out.
The protocol surface (events, proposals, decisions, summary) and the auth
model are meant to stay — they're what makes an agent built this way
conformant with the selfctl agent protocol.

## License

MIT — see [LICENSE](./LICENSE).
