import { type Tool } from './types';
import { type BashInput } from './bash-target';
import { createShellTool } from './shell';

export const bashTool: Tool<BashInput> = createShellTool('bash');
