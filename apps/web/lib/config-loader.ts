import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'yaml';

/**
 * Loads a YAML configuration file from the project `config` directory.
 *
 * @example
 * interface ServerConfig {
 *   host: string;
 *   port: number;
 * }
 * const cfg = loadYamlConfig<ServerConfig>('server.yml');
 *
 * @param filename - Name of the YAML file to load relative to `config/`.
 * @template T - Expected shape of the parsed configuration object.
 * @throws If the file cannot be read or contains invalid YAML.
 * @returns Parsed configuration typed as `T`.
 */
export function loadYamlConfig<T>(filename: string): T {
  const filePath = resolve(process.cwd(), 'config', filename);

  let content: string;
  try {
    content = readFileSync(filePath, 'utf8');
  } catch {
    throw new Error(`Config file not found: ${filePath}`);
  }

  try {
    return parse(content) as T;
  } catch (err) {
    throw new Error(`Failed to parse YAML in ${filePath}: ${(err as Error).message}`);
  }
}
