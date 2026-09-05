# selfctl agent starter

A fork of this repo is an app: TanStack Start pages and typed server functions
over your own database, with the whole selfctl agent protocol served under
`/agent/*` by [`@selfctl/agent-kit`](https://www.npmjs.com/package/@selfctl/agent-kit) —
one server route, a background turn function, and a scheduled tick. The
template itself carries no protocol code; it describes an agent, ships one
skill, and gives you an admin page.

## Deploy

[![Deploy to Netlify](https://www.netlify.com/img/deploy/button.svg)](https://app.netlify.com/start/deploy?repository=https://github.com/seancdavis/selfctl-template)

1. Click the button above.
2. When prompted, set `AGENT_ADMIN_KEY` to a long, random value — this is the
   deploy-time root secret for your agent. Only you (the deployer) should
   know it.
3. Once the deploy finishes, open the deployed site and unlock the admin page
   with your admin key to get the connection token (see below).

A real model reply needs Netlify AI Gateway, which only injects credentials
for a deployed site or a project linked with `netlify link` — it isn't
available to an unlinked local `vite dev`.

`@netlify/database` auto-provisions a Postgres database, but does not
auto-apply migrations — see [Local dev](#local-dev) and `docs/smoke.md`.

## File map

| Path | What it is |
|---|---|
| `selfctl.config.ts` | The only place the agent is described — id, system prompt, skills, model shortlist. |
| `db/schema.ts` | Your database schema: the kit's tables via `export * from "@selfctl/agent-kit/db"`, plus your own (`notes`). |
| `skills/` | What your agent can do — see `skills/notes.ts`. |
| `src/routes/agent.$.ts` | The protocol mount: every HTTP method under `/agent/*` goes to the kit's handler. |
| `src/routes/index.tsx` | The admin page — claim flow + model picker, nothing else. |
| `netlify/functions/agent-turn.ts` | The background function that actually runs a turn. |
| `netlify/functions/agent-tick.ts` | The once-a-minute scheduler that drains due tasks. |
| `netlify/edge-functions/cors.ts` | CORS for `/agent/*`, wired to the kit's implementation. |
| `netlify/database/migrations/` | Fork-owned migrations — the single source of truth for the deployed database. |

## Connecting a client

A client (a desktop app, a script, curl) talks to the protocol at:

```
https://<your-site>/agent
```

with a connection token as the bearer. To get that token, open the deployed
site, enter your `AGENT_ADMIN_KEY` in the unlock form, and copy the token it
reveals. The admin key itself also works as a bearer against `/agent/*` — the
admin can do anything a client can.

## The database

You own it. `db/schema.ts` re-exports the kit's tables (`selfctl_*`: the
event log, proposals, threads, turns, scheduled tasks, config) alongside your
own domain tables — the kit ships their shape as Drizzle definitions only, no
runtime DDL and no migrations of its own. Your `netlify/database/migrations/`
folder is the single source of truth for what's deployed.

Upgrading the kit:

```sh
npm i @selfctl/agent-kit@latest
npm run db:generate   # writes a new migration
```

Review the generated SQL, then commit the migration.

## The frontend rule

- **Read anything directly.** Pages and server functions can query the
  database with Drizzle in a loader or server function — kit tables
  included. There's no API to go through for reads.
- **Write only through `/agent/*`.** A page that writes a domain table
  directly has walked around the gate. Which route it takes depends on who is
  doing the writing — see below.

## The four surfaces a skill has

Two of these write. They differ by *who initiates*, not by how dangerous they
are.

| Surface | Initiated by | Approval | Declared with | Reached at |
|---|---|---|---|---|
| **Proposal** | the agent, mid-turn | yes | `defineProposalKind` + `rt.propose` | `POST /agent/proposals/:id/decision` |
| **Mutation** | a client | no | `defineMutation` | `POST /agent/mutations` |
| **Component** | the agent, mid-turn | writes nothing | `rt.emit(kind, payload)` | rides along on the chat reply |
| **Widget** | a client, on demand | writes nothing | `WidgetProducer` | `GET /agent/summary/widgets` |

**Proposals** are for writes the agent *wants*. Nothing lands until a decision
arrives: `approve` writes the proposed payload, `override` writes a corrected
one. `reject` and `rejectWithFeedback` write nothing at all — a rejected
proposal leaves no trace in your tables, only in the kit's own
`selfctl_proposals`.

**Mutations** are for writes the human already performed by tapping something —
a checkbox, a "mark as done" button. The decision happened in the UI, so asking
for it again is noise. `defineMutation` looks exactly like
`defineProposalKind`, but it applies immediately, and only a client can apply
one; a skill's own tools cannot.

**Components** and **widgets** don't write. `rt.emit("reference.note-list", …)`
attaches a typed payload to the assistant's reply so a client can render a card
instead of a paragraph; a widget does the same for at-a-glance state, produced
on request rather than during a turn. Both kinds are free-form strings.

Declaring mutations, widgets or task handlers adds `mutations`, `widgets` or
`scheduler` to what `GET /agent/summary` advertises.

> Cards are rendered by the *client*, and a client only renders the kinds it
> knows about. In the selfctl desktop app an unknown proposal kind falls back
> to a JSON dump, and an unknown component renders nothing at all.

## Adding a skill

A skill bundles those surfaces, plus task handlers — deterministic work the
scheduled tick drains later:

```ts
export const mySkill: Skill = {
  name: "my-skill",
  tools: (rt) => [ /* what the model can call */ ],
  proposals: [ /* gated writes */ ],
  mutations: [ /* ungated, client-applied writes */ ],
  widgets: [ /* at-a-glance cards */ ],
  taskHandlers: [ /* work the tick drains */ ],
};
```

Only `name` is required. Tools read through `rt.db`, a read seam over the same
database your pages query. Start from `skills/notes.ts` — it shows a proposal
kind, the tool that proposes it, and a read tool that emits a component — then
register the new skill in `selfctl.config.ts`'s `skills: [...]` array.

## Local dev

```sh
AGENT_ADMIN_KEY=your-dev-key npm run dev
```

Then, once, apply migrations — the Netlify database plugin does not
auto-apply them:

```sh
npx netlify database migrations apply
```

`src/routeTree.gen.ts` is generated by `npm run dev` or `npm run build`. On a
fresh clone, run one of those before `npm run typecheck`.

See `docs/smoke.md` for the full end-to-end local smoke of the protocol
surface (threads, messages, the event log, streaming, the scheduled tick).

## Env vars

| Variable | Required | What it does |
|---|---|---|
| `AGENT_ADMIN_KEY` | yes | The one root secret. Gates the admin routes and mints the connection token. |
| `OPENROUTER_API_KEY` | only if you switch providers | The default provider is Netlify AI Gateway, which needs no key of yours. |

## License

MIT — see [LICENSE](./LICENSE).
