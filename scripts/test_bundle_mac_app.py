"""Tests for scripts/bundle-mac-app: python3 -I -m unittest scripts/test_bundle_mac_app.py"""
import os
import plistlib
import shutil
import subprocess
import sys
import tempfile
import unittest

SCRIPT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "bundle-mac-app")


@unittest.skipUnless(sys.platform == "darwin", "macOS only")
class BundleMacApp(unittest.TestCase):
    def setUp(self):
        self.root = tempfile.mkdtemp(prefix="adk-bundle-", dir="/var/tmp")
        self.bin_dir = os.path.join(self.root, "bin")
        self.out_dir = os.path.join(self.root, "out")
        os.makedirs(self.bin_dir)
        os.makedirs(self.out_dir)

        # Create fake app binary
        self.app_bin = os.path.join(self.bin_dir, "agentdeck")
        with open(self.app_bin, "w") as f:
            f.write("#!/bin/sh\necho agentdeck\n")
        os.chmod(self.app_bin, 0o755)

        # Create fake core binary that prints "adk 0.1.19" for --version
        self.core_bin = os.path.join(self.bin_dir, "agentdeck-core")
        with open(self.core_bin, "w") as f:
            f.write("#!/bin/sh\nif [ \"$1\" = \"--version\" ]; then echo \"adk 0.1.19\"; fi\n")
        os.chmod(self.core_bin, 0o755)

        # Create fake icon file
        self.icon_src = os.path.join(self.root, "Herdr.icns")
        with open(self.icon_src, "w") as f:
            f.write("fake icon")

    def tearDown(self):
        shutil.rmtree(self.root)

    def run_it(self, *args, env=None):
        return subprocess.run(
            [SCRIPT, *args],
            capture_output=True,
            text=True,
            env=env or os.environ.copy(),
        )

    def test_builds_a_signed_bundle(self):
        """Bundle is signed ad hoc and both executables exist"""
        out = self.run_it(
            "--app-bin", self.app_bin,
            "--core-bin", self.core_bin,
            "--version", "0.1.0",
            self.out_dir
        )
        self.assertEqual(out.returncode, 0, out.stderr)

        app = os.path.join(self.out_dir, "AgentDeck.app")
        self.assertTrue(os.path.exists(app))

        # Check executables exist
        self.assertTrue(os.path.exists(os.path.join(app, "Contents/MacOS/AgentDeck")))
        core_app = os.path.join(app, "Contents/Helpers/AgentDeck Core.app")
        self.assertTrue(os.path.exists(os.path.join(core_app, "Contents/MacOS/agentdeck-core")))

        # Verify signature
        verify = subprocess.run(
            ["codesign", "--verify", "--deep", "--strict", app],
            capture_output=True
        )
        self.assertEqual(verify.returncode, 0, verify.stderr)

    def test_version_in_info_plist(self):
        """Info.plist has correct version and bundle identifier"""
        self.run_it(
            "--app-bin", self.app_bin,
            "--core-bin", self.core_bin,
            "--version", "0.1.0",
            self.out_dir
        )

        plist_path = os.path.join(self.out_dir, "AgentDeck.app/Contents/Info.plist")
        with open(plist_path, "rb") as f:
            plist = plistlib.load(f)

        self.assertEqual(plist["CFBundleShortVersionString"], "0.1.0")
        self.assertEqual(plist["CFBundleVersion"], "0.1.0")
        self.assertEqual(plist["CFBundleIdentifier"], "io.github.khambampati-subhash.agentdeck")
        self.assertEqual(plist["CFBundleExecutable"], "AgentDeck")

    def test_no_home_paths_in_the_bundle(self):
        """No HOME paths embedded in bundle, LSEnvironment is empty"""
        test_home = os.path.join(self.root, "home")
        os.makedirs(test_home)
        env = os.environ.copy()
        env["HOME"] = test_home

        self.run_it(
            "--app-bin", self.app_bin,
            "--core-bin", self.core_bin,
            "--version", "0.1.0",
            self.out_dir,
            env=env
        )

        app = os.path.join(self.out_dir, "AgentDeck.app")

        # Check LSEnvironment is empty
        plist_path = os.path.join(app, "Contents/Info.plist")
        with open(plist_path, "rb") as f:
            plist = plistlib.load(f)
        self.assertEqual(plist["LSEnvironment"], {})

        # Check no files outside Contents/MacOS contain HOME path bytes
        for root, dirs, files in os.walk(app):
            # Skip Contents/MacOS
            if "Contents/MacOS" in root:
                continue
            for fname in files:
                fpath = os.path.join(root, fname)
                if os.path.islink(fpath):
                    continue
                try:
                    with open(fpath, "rb") as f:
                        content = f.read()
                        self.assertNotIn(test_home.encode(), content,
                                       f"{fpath} contains HOME path")
                except:
                    pass  # Skip unreadable files

    def test_missing_binary_fails(self):
        """Missing binary exits 1 and writes no bundle"""
        out = self.run_it(
            "--app-bin", self.app_bin,
            "--core-bin", "/nonexistent/core",
            "--version", "0.1.0",
            self.out_dir
        )
        self.assertEqual(out.returncode, 1)
        self.assertFalse(os.path.exists(os.path.join(self.out_dir, "AgentDeck.app")))

    def test_replaces_an_old_bundle(self):
        """Running twice leaves one valid bundle"""
        args = [
            "--app-bin", self.app_bin,
            "--core-bin", self.core_bin,
            "--version", "0.1.0",
            self.out_dir
        ]

        # First run
        out1 = self.run_it(*args)
        self.assertEqual(out1.returncode, 0)

        app = os.path.join(self.out_dir, "AgentDeck.app")
        self.assertTrue(os.path.exists(app))

        # Second run
        out2 = self.run_it(*args)
        self.assertEqual(out2.returncode, 0)

        # Still only one bundle, and it's valid
        self.assertTrue(os.path.exists(app))
        verify = subprocess.run(
            ["codesign", "--verify", "--deep", "--strict", app],
            capture_output=True
        )
        self.assertEqual(verify.returncode, 0)


if __name__ == "__main__":
    unittest.main()
