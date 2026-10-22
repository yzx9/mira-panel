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
          # The screen-state helper, compiled from source at build time. Only
          # touched when presence is enabled, so a swiftc/toolchain hiccup
          # cannot block the plain notifier.
          screenWatch = pkgs.runCommand "mira-screen-watch" {
            # clang: the swift wrapper's setup hook expects NIX_CC, which only
            # a cc-wrapper's hook defines — runCommand's stdenvNoCC has none
            # (caught by the first real darwin build).
            nativeBuildInputs = [ pkgs.swift pkgs.clang ];
          } ''
            swiftc ${self}/packages/companion/src/screen-watch.swift -o $out
          '';
          presenceEnv =
            lib.optionalAttrs (cfg.enablePresence && cfg.controllerKeyFile != "") {
              PANEL_SCREEN_HELPER = "${screenWatch}";
              # The KEY lives in this file (agens/gopass-managed, chmod 600);
              # types.str on purpose — types.path would copy it into the
              # world-readable nix store.
              PANEL_CONTROLLER_KEY_FILE = cfg.controllerKeyFile;
            };
        in
        {
          options.services.mira-panel-companion = {
            enable = lib.mkEnableOption "the Mira panel companion notifier";

            panelUrl = lib.mkOption {
              type = lib.types.str;
              example = "ws://192.0.2.10:15932/ws";
              description = "WebSocket URL of the panel this device watches.";
            };

            enablePresence = lib.mkOption {
              type = lib.types.bool;
              default = false;
              description = ''
                Drive the panel's controller presence lease from this device's screen
                lock state (screen unlocked = panel may auto-unlock). Needs
                controllerKeyFile and a matching PANEL_CONTROLLER_KEY on the panel.
              '';
            };

            controllerKeyFile = lib.mkOption {
              type = lib.types.str;
              default = "";
              example = "/Users/you/.config/mira-panel/controller.key";
              description = ''
                Absolute path of the one-line device key file. A string, NOT
                a path: types.path would copy the secret into the nix store.
              '';
            };
          };

          config = lib.mkIf cfg.enable {
            # A user agent, not a daemon: osascript notifications (and the
            # screen-state distributed notifications) belong to a GUI login
            # session. RunAtLoad + KeepAlive = always-on watcher.
            launchd.user.agents.mira-panel-companion = {
              command = "${
                lib.getExe pkgs.nodejs_24
              } ${self}/packages/companion/src/companion.ts";
              serviceConfig = {
                RunAtLoad = true;
                KeepAlive = true;
                EnvironmentVariables = {
                  PANEL_URL = cfg.panelUrl;
                } // presenceEnv;
              };
            };
          };
        };
    };
}
