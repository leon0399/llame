# Dev-only shell: reproducible Node/pnpm toolchain for local development.
# Not a build/packaging flake — llame ships no Nix package output.
{
  description = "llame dev shell";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";

  outputs =
    { self, nixpkgs }:
    let
      # The systems nixpkgs-unstable still supports; it dropped x86_64-darwin
      # in 26.11.
      systems = [
        "x86_64-linux"
        "aarch64-linux"
        "aarch64-darwin"
      ];
    in
    {
      devShells = nixpkgs.lib.genAttrs systems (
        system:
        let
          pkgs = nixpkgs.legacyPackages.${system};
        in
        {
          default = pkgs.mkShell {
            packages = [
              pkgs.nodejs_22
              pkgs.pnpm_12
            ];
          };
        }
      );
    };
}
