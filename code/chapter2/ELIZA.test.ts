import assert from "node:assert/strict";

import { respond, swapPronouns } from "./ELIZA.js";

const firstChoice = () => 0;

assert.equal(swapPronouns("I am my father"), "you are your father");
assert.equal(respond("I need advice", firstChoice), "Why do you need advice?");
assert.equal(
  respond("Why can't I leave?", firstChoice),
  "Do you think you should be able to leave?",
);
assert.equal(
  respond("my mother was kind", firstChoice),
  "Tell me more about your mother.",
);
assert.equal(respond("Something else", firstChoice), "Please tell me more.");

console.log("ELIZA tests passed.");
