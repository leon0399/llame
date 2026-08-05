# Dev-only shell: reproducible Node/pnpm toolchain for local development.
# Not a build/packaging flake — llame ships no Nix package output.
{
  description = "llame dev shell";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
  inputs.flake-utils.url = "github:numtide/flake-utils";

  outputs =
    { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (
      system:
      let
        pkgs = nixpkgs.legacyPackages.${system};
      in
      {
        devShells.default = pkgs.mkShell {
          packages = [
            pkgs.nodejs_22
            pkgs.pnpm_10
            # lefthook's "api no new unknown-as casts" gate (#268) needs both.
            pkgs.ast-grep
            pkgs.jq
          ];
        };
      }
    );
}
