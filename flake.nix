{
  description = "Paperling — a minimal, distraction-free Markdown editor with live preview, math, diagrams, and an optional AI assistant";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs =
    { self
    , nixpkgs
    , flake-utils
    }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = nixpkgs.legacyPackages.${system};
        isLinux = pkgs.stdenv.isLinux;
        pname = "paperling";
        version = "1.0.49";

        # The webview frontend. Tauri's build.rs embeds the assets from
        # `frontendDist` (../dist) at compile time, so the Rust build needs
        # this directory in place before cargo runs.
        frontend = pkgs.stdenvNoCC.mkDerivation {
          name = "${pname}-frontend-${version}";
          src = ./.;

          nativeBuildInputs = [ pkgs.bun ];

          configurePhase = ''
            runHook preConfigure
            export BUN_INSTALL_CACHE_DIR=$TMPDIR/bun-cache
            runHook postConfigure
          '';

          buildPhase = ''
            runHook preBuild
            bun install --frozen-lockfile
            bun run build
            runHook postBuild
          '';

          installPhase = ''
            runHook preInstall
            cp -r dist "$out"
            runHook postInstall
          '';

          # No ELF artifacts to patch; bun.lock pins the exact dependency tree.
          dontFixup = true;
        };
      in
      {
        packages.default = pkgs.rustPlatform.buildRustPackage {
          pname = pname;
          inherit version;

          src = ./.;
          # The Rust crate lives in src-tauri with its own Cargo.lock.
          sourceRoot = "source/src-tauri";
          cargoLock.lockFile = ./src-tauri/Cargo.lock;

          nativeBuildInputs = with pkgs;
            [
              pkg-config
            ]
            ++ pkgs.lib.optionals isLinux [
              gobject-introspection
              wrapGAppsHook3
            ];

          # Linux: the Tauri GTK/WebKit stack. macOS: Tauri uses the system
          # WKWebView through Rust bindings, so no extra libraries needed.
          buildInputs = with pkgs;
            pkgs.lib.optionals isLinux [
              glib
              gtk3
              libsoup_3
              webkitgtk_4_1
              cairo
              pango
              gdk-pixbuf
              openssl
              libayatana-appindicator
              librsvg
            ];

          # Tauri's build script embeds the frontend assets at compile time;
          # place the prebuilt dist where tauri.conf.json's `frontendDist`
          # (../dist, relative to src-tauri) points.
          preBuild = ''
            cp -r ${frontend} ../dist
            chmod -R u+w ../dist
          '';

          doCheck = false;

          meta = with pkgs.lib; {
            description = "A minimal, distraction-free Markdown editor";
            homepage = "https://github.com/Razee4315/Paperling";
            license = licenses.asl20;
            mainProgram = pname;
            platforms = platforms.linux ++ platforms.darwin;
          };
        };

        packages.${pname} = self.packages.${system}.default;

        devShells.default = pkgs.mkShell {
          packages = with pkgs;
            [
              bun
              rustc
              cargo
              pkg-config
            ]
            ++ pkgs.lib.optionals isLinux [
              gobject-introspection
              gtk3
              webkitgtk_4_1
              libsoup_3
            ];
        };

        apps.default = flake-utils.lib.mkApp {
          drv = self.packages.${system}.default;
        };
      });
}
