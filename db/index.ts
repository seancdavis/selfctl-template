import { drizzle } from "drizzle-orm/netlify-db";
import * as schema from "./schema";

// The connection is configured automatically by the Netlify runtime — no
// connection string needed here.
export const db = drizzle({ schema });
