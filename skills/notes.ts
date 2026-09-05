import { defineProposalKind, type Skill, type Sql } from "@selfctl/agent-kit";
import { z } from "zod";

// The `reference.note` proposal kind: its payload is the note text, and
// `write` is the trusted-side effect that runs once a human approves (or
// overrides) the proposal — the kit's gate calls this inside a DB transaction.
const NotePayload = z.object({ text: z.string().min(1).max(4000) });

const noteProposalKind = defineProposalKind({
  kind: "reference.note",
  schema: NotePayload,
  write: async (sql: Sql, payload) => {
    await sql`INSERT INTO notes (text) VALUES (${payload.text})`;
  },
});

// The tool the model calls. It never writes anything itself — `rt.propose`
// just records a pending proposal; nothing lands in `notes` until a human
// approves it through `POST /agent/proposals/:id/decision`.
export const notesSkill: Skill = {
  name: "notes",
  proposals: [noteProposalKind],
  tools: (rt) => [
    {
      name: "createNote",
      description:
        "Propose saving a short note for later reference. This only creates a proposal — a human must approve it before anything is actually saved.",
      parameters: {
        type: "object",
        properties: {
          text: {
            type: "string",
            description: "The note text to propose saving.",
          },
        },
        required: ["text"],
        additionalProperties: false,
      },
      execute: async (args: unknown) => {
        const payload = NotePayload.parse(args);
        return rt.propose("reference.note", payload);
      },
    },
    // The other two seams a tool has. `rt.db` reads the fork's own tables —
    // the same database a page queries, so a tool never needs an API of its
    // own. `rt.emit` attaches a typed payload to the assistant's reply, which
    // is how a client renders a card instead of a paragraph; the kind is a
    // free-form string, and a client that doesn't know it renders nothing.
    // Neither one writes: reads stay reads, and the gate stays the only way in.
    {
      name: "listNotes",
      description:
        "List the notes that have actually been saved. This reflects what a human approved — not what has merely been proposed.",
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      execute: async () => {
        const rows = await rt.db<{ id: string; text: string; created_at: Date }[]>`
          SELECT id, text, created_at FROM notes ORDER BY created_at DESC LIMIT 20
        `;
        const notes = rows.map((row) => ({
          id: row.id,
          text: row.text,
          createdAt: row.created_at,
        }));
        rt.emit("reference.note-list", { notes });
        return notes;
      },
    },
  ],
};
