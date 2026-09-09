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

        # Hashes of the sandboxed bun dependency fetch, per platform (Nix
        # fixed-output derivation: network access is allowed here and the
        # result is pinned by hash). Add a platform by building once and
        # copying the `got: sha256-...` line nix prints.
        bunDepsHashes = {
          x86_64-linux = "sha256-kl3u7NHzfL2tzG4s3ive9wc1Z8x47K6k0UnwgwfTVNM=";
        };

        # Dependency fetch (fixed-output, so the sandbox grants network).
        # Runs `bun install --frozen-lockfile` against the checked-in
        # bun.lock and exposes the resulting node_modules tree.
        bunDeps = pkgs.stdenvNoCC.mkDerivation {
          pname = "${pname}-bun-deps";
          inherit version;
          src = ./.;

          nativeBuildInputs = [ pkgs.bun ];

          buildPhase = ''
            export BUN_INSTALL_CACHE_DIR=$TMPDIR/bun-cache
            bun install --frozen-lockfile
          '';
          installPhase = ''
            mkdir -p "$out/node_modules"
            cp -r node_modules/. "$out/node_modules/"
          '';
          dontFixup = true;

          outputHashAlgo = "sha256";
          outputHashMode = "recursive";
          outputHash = bunDepsHashes.${system} or (throw ''
            paperling: no bun dependency hash for ${system}.
            Run `nix build` once and copy the `got: sha256-...` hash into
            bunDepsHashes in flake.nix.
          '');
        };

        # The webview frontend. Tauri's build.rs embeds the assets from
        # `frontendDist` (../dist) at compile time, so the Rust build needs
        # this directory in place before cargo runs. Offline: node_modules
        # comes from the pinned bunDeps output above.
        frontend = pkgs.stdenvNoCC.mkDerivation {
          name = "${pname}-frontend-${version}";
          src = ./.;

          nativeBuildInputs = [ pkgs.bun ];

          configurePhase = ''
            runHook preConfigure
            cp -a ${bunDeps}/node_modules ./node_modules
            chmod -R u+w node_modules
            runHook postConfigure
          '';

          buildPhase = ''
            runHook preBuild
            bun run build
            runHook postBuild
          '';

          installPhase = ''
            runHook preInstall
            cp -r dist "$out"
            runHook postInstall
          '';

          # No ELF artifacts to patch; the lockfile pinned the deps.
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
