# Development environment for the mira-panel monorepo.
# Enter with direnv (`use flake` in .envrc) or `nix develop`.
{
  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs = { self, nixpkgs }:
    let
      forAll = nixpkgs.lib.genAttrs nixpkgs.lib.systems.flakeExposed;
    in
    {
      devShells = forAll (system:
        let pkgs = nixpkgs.legacyPackages.${system};
        in {
          default = pkgs.mkShell {
            # nodejs_24 runs .ts natively (type stripping); chromium is here for
            # the headless screenshot verification workflow (see README); just
            # drives the service-control recipes (see justfile).
            packages = [ pkgs.nodejs_24 pkgs.just ]
              ++ pkgs.lib.optionals pkgs.stdenv.isLinux [ pkgs.chromium ];
          };
        });
    };
}
