# Reproducible development shell and experimental local Sandbox image.
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
        sandboxTools = [
          pkgs.bashInteractive
          pkgs.cacert
          pkgs.coreutils
          pkgs.fd
          pkgs.git
          pkgs.jq
          pkgs.nodejs_22
          pkgs.pnpm_10
          pkgs.ripgrep
        ];
        sandboxIdentity = [
          (pkgs.writeTextDir "etc/passwd" ''
            root:x:0:0::/root:${pkgs.runtimeShell}
            llame:x:1000:1000::/home/llame:${pkgs.bashInteractive}/bin/bash
          '')
          (pkgs.writeTextDir "etc/group" ''
            root:x:0:
            llame:x:1000:
          '')
        ];
      in
      {
        devShells.default = pkgs.mkShell {
          packages = [
            pkgs.nodejs_22
            pkgs.pnpm_10
          ];
        };

        packages.sandbox-image = pkgs.dockerTools.buildLayeredImage {
          name = "llame-sandbox";
          tag = "experiment";
          contents = sandboxTools ++ sandboxIdentity;
          fakeRootCommands = ''
            mkdir -p ./home/llame ./workspace ./tmp
            chown 1000:1000 ./home/llame ./workspace ./tmp
          '';
          config = {
            User = "1000:1000";
            WorkingDir = "/workspace";
            Env = [
              "HOME=/home/llame"
              "PATH=${pkgs.lib.makeBinPath sandboxTools}"
              "SSL_CERT_FILE=${pkgs.cacert}/etc/ssl/certs/ca-bundle.crt"
            ];
            Cmd = [ "${pkgs.bashInteractive}/bin/bash" ];
          };
        };
      }
    );
}
