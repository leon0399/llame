Temporary asset-rule fixture. It exists only so a build proves that the
`**/prompts/**/*.md` asset glob in nest-cli.json copies a colocated template
into dist. The rail layer replaces this file with its first real packaged
template; nothing depends on these bytes.
