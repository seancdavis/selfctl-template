# selfctl agent starter

A minimal, deployable, protocol-conformant **selfctl agent** — a Netlify site
that implements the selfctl agent protocol over HTTP. Fork it, deploy it, and
you have a running agent in minutes.

`POST /message` runs a real LLM turn via `runTurn` from
[`@selfctl/agent-kit`](https://www.npmjs.com/package/@selfctl/agent-kit): the
model can call a `createNote` tool, which proposes a `reference.note` — it
never writes anything itself. Approving (or overriding) the proposal is what
actually runs the skill's `write()` and lands a row in the `notes` table, via
agent-kit's gate (`POST /proposals/:id/decision`). That message → LLM →
proposal → human decision → write loop, over the cursored event log, is the
whole point of this starter: it's the smallest possible agent that's
conformant with the selfctl agent protocol.

## Deploy

[![Deploy to Netlify](https://www.netlify.com/img/deploy/button.svg)](https://app.netlify.com/start/deploy?repository=https://github.com/seancdavis/selfctl-template)

1. Click the button above.
2. When prompted, set `AGENT_ADMIN_KEY` to a long, random value — this is the
   deploy-time root secret for your agent. Only you (the deployer) should
   know it.
3. Also set `OPENROUTER_API_KEY` (an [OpenRouter](https://openrouter.ai/keys)
   API key) — `POST /message` needs it to run the LLM turn.
4. Once the deploy finishes, open the deployed site.
5. Enter your admin key in the **Unlock** form and click **Unlock** — this
   reveals the connection token.
6. Copy the connection token and hand it to whatever client will talk to the
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

Set `AGENT_ADMIN_KEY` and `OPENROUTER_API_KEY` in the site's environment (or a
local `.env`) before starting.

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
agent identity in `netlify/functions/_shared/agent.ts`, and add your own
skills next to `netlify/functions/_shared/skills/notes.ts` (each skill is a
`Skill` from `@selfctl/agent-kit` — one or more `defineProposalKind`s, plus
the tools the model calls to propose them — registered in
`netlify/functions/_shared/deps.ts`'s `buildRegistry([...])` call). The
protocol surface (events, proposals, decisions, summary) and the auth model
are meant to stay — they're what makes an agent built this way conformant
with the selfctl agent protocol.

Conversation memory is intentionally out of scope for this starter: `runTurn`
is called with `history: []` (single-turn) — there's no messages table.

## License

MIT — see [LICENSE](./LICENSE).
