/**
 * Per-tool rerank settings for the experimental decision lane. They live
 * beside the tool's own settings — `webSearch.rerank` and `tools.grep.rerank` —
 * because the tool, not the lane, decides whether it reranks and which
 * catalogue model judges it. An absent block means off.
 */

/**
 * The modes that call the decision model. Closed on purpose: a mode a tool
 * cannot implement fails schema validation, not a tool call. There is no
 * `off`: removing the block is how a tool stops reranking.
 */
export const TOOL_RERANK_MODES = ['shadow', 'on'] as const;
export type ToolRerankMode = (typeof TOOL_RERANK_MODES)[number];

/** Resolved rerank settings of one tool. */
export type ToolRerankConfig = {
  readonly mode: ToolRerankMode;
  /** A `decisionModels[].id`; the boot loader proves it exists. */
  readonly model: string;
};

/** The still-uninterpolated block, once the published schema has validated it. */
export type RawToolRerankConfig = {
  mode: ToolRerankMode;
  model: string;
};
