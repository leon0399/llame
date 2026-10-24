import type {
  ProjectRepositoryLinkWithDefaultsResponse as GeneratedProjectRepositoryLink,
  ProjectResponse as GeneratedProjectResponse,
} from "../../api/generated/models";

/** Feature-owned facade for the generated project response model. */
export type ProjectResponse = GeneratedProjectResponse;

/** One project link: its alias, flags, policy, and per-executor defaults. */
export type ProjectRepositoryLink = GeneratedProjectRepositoryLink;

/** The isolation default a link carries. */
export type IsolationPolicy = ProjectRepositoryLink["isolation"];
