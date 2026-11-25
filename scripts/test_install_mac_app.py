"""Tests for scripts/install-mac-app: python3 -I -m unittest scripts/test_install_mac_app.py"""
import os
import plistlib
import shutil
import subprocess
import sys
import tempfile
import unittest

SCRIPT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "install-mac-app")


@unittest.skipUnless(sys.platform == "darwin", "macOS only")
class InstallMacApp(unittest.TestCase):
    def setUp(self):
        self.root = tempfile.mkdtemp(prefix="adk-install-", dir="/var/tmp")
        self.test_home = os.path.join(self.root, "home")
        os.makedirs(self.test_home)

        # Create fake binaries
        bin_dir = os.path.join(self.root, "bin")
        os.makedirs(bin_dir)

        self.app_bin = os.path.join(bin_dir, "agentdeck")
        with open(self.app_bin, "w") as f:
            f.write("#!/bin/sh\necho agentdeck\n")
        os.chmod(self.app_bin, 0o755)

        self.core_bin = os.path.join(bin_dir, "agentdeck-core")
        with open(self.core_bin, "w") as f:
            f.write("#!/bin/sh\nif [ \"$1\" = \"--version\" ]; then echo \"adk 0.1.19\"; fi\n")
        os.chmod(self.core_bin, 0o755)

        self.app_path = os.path.join(self.test_home, "Applications/AgentDeck.app")
        self.core_path = os.path.join(self.app_path, "Contents/Helpers/AgentDeck Core.app")

    def tearDown(self):
        shutil.rmtree(self.root)

    def test_lsenvironment_path_uses_final_installed_location(self):
        """LSEnvironment PATH points to final installed path, not staging"""
        env = os.environ.copy()
        env["HOME"] = self.test_home
        env["APP_BIN"] = self.app_bin
        env["CORE_BIN"] = self.core_bin
        # Never register the scratch app in the real LaunchServices database.
        env["ADK_LSREGISTER"] = "0"

        result = subprocess.run(
            [SCRIPT, "--no-build"],
            capture_output=True,
            text=True,
            env=env,
        )
        self.assertEqual(result.returncode, 0, result.stderr)

        # Read the installed Info.plist
        plist_path = os.path.join(self.app_path, "Contents/Info.plist")
        self.assertTrue(os.path.exists(plist_path), "Info.plist not found")

        with open(plist_path, "rb") as f:
            plist = plistlib.load(f)

        # Verify PATH starts with the final installed core location
        path = plist["LSEnvironment"]["PATH"]
        expected_core_path = os.path.join(self.core_path, "Contents/MacOS")
        self.assertTrue(path.startswith(expected_core_path),
                       f"PATH should start with {expected_core_path}, got {path}")

        # Verify the core path exists
        self.assertTrue(os.path.exists(expected_core_path),
                       f"Core path {expected_core_path} does not exist")

        # Verify staging directory was cleaned up
        staging = os.path.join(self.test_home, "Applications/.agentdeck-staging")
        self.assertFalse(os.path.exists(staging),
                        "Staging directory should be cleaned up")

    def test_stops_core_left_from_previous_install(self):
        """A core still running the old build is stopped (macOS denies its shells otherwise)"""
        env = os.environ.copy()
        env["HOME"] = self.test_home
        env["APP_BIN"] = self.app_bin
        env["CORE_BIN"] = self.core_bin
        env["ADK_LSREGISTER"] = "0"
        # A previous install whose core is still running.
        old_core = os.path.join(self.core_path, "Contents/MacOS/agentdeck-core")
        os.makedirs(os.path.dirname(old_core))
        with open(old_core, "w") as f:
            f.write("#!/bin/sh\nsleep 60\n")
        os.chmod(old_core, 0o755)
        running = subprocess.Popen([old_core], start_new_session=True)
        try:
            result = subprocess.run([SCRIPT, "--no-build"], capture_output=True, text=True, env=env)
            self.assertEqual(result.returncode, 0, result.stderr)
            running.wait(timeout=10)
        finally:
            os.killpg(running.pid, 9) if running.poll() is None else None


if __name__ == "__main__":
    unittest.main()
