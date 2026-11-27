import { type Tool } from './types';
import { type BashInput } from './bash-target';
import { createShellTool } from './shell';

export const zshTool: Tool<BashInput> = createShellTool('zsh');
