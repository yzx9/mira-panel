# Development environment for the mira-panel monorepo.
# Enter with direnv (`use flake` in .envrc) or `nix develop`.
#
# darwinModules.panelCompanion: importable nix-darwin module that runs the
# receive-only macOS notifier (packages/companion) as the logged-in user's
# launchd agent. The companion is dependency-free JavaScript (Node >= 22's
# global WebSocket), so the module runs the source file straight off the
# flake store path — no node_modules, no bundling step.
{
  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs =
    { self, nixpkgs }:
    let
      forAll = nixpkgs.lib.genAttrs nixpkgs.lib.systems.flakeExposed;
    in
    {
      devShells = forAll (
        system:
        let
          pkgs = nixpkgs.legacyPackages.${system};
        in
        {
          default = pkgs.mkShell {
            # nodejs_24 runs .ts natively (type stripping); chromium is here for
            # the headless screenshot verification workflow (see README); just
            # drives the service-control recipes (see justfile).
            packages = with pkgs; [
              nodejs_24

              playwright-mcp
            ];
          };
        }
      );

      darwinModules.panelCompanion =
        {
          config,
          lib,
          pkgs,
          ...
        }:
        let
          cfg = config.services.mira-panel-companion;
        in
        {
          options.services.mira-panel-companion = {
            enable = lib.mkEnableOption "the Mira panel companion notifier";

            panelUrl = lib.mkOption {
              type = lib.types.str;
              example = "ws://192.168.1.10:15932/ws";
              description = "WebSocket URL of the panel this Mac watches.";
            };
          };

          config = lib.mkIf cfg.enable {
            # A user agent, not a daemon: osascript notifications belong to a
            # GUI login session. RunAtLoad + KeepAlive = always-on watcher.
            launchd.user.agents.mira-panel-companion = {
              command = "${
                lib.getExe pkgs.nodejs_24
              } ${self}/packages/companion/src/companion.ts";
              serviceConfig = {
                RunAtLoad = true;
                KeepAlive = true;
                EnvironmentVariables.PANEL_URL = cfg.panelUrl;
              };
            };
          };
        };
    };
}
