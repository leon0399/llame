import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Opt a route (or controller) OUT of the global session guard (#68).
 *
 * The default is fail-closed: every controller route requires a verified
 * session unless explicitly marked public — adding a new controller without
 * thinking about auth yields 401s, not a silent public surface.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
