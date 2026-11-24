import Anthropic from "@anthropic-ai/sdk";

export const MODEL = "claude-opus-5-5";

// Reads ANTHROPIC_API_KEY from the environment. Server-only: never import from client components.
export const anthropic = new Anthropic();
