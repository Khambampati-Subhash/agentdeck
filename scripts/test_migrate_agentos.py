"""Tests for scripts/migrate-agentos: python3 -I -m unittest scripts/test_migrate_agentos.py"""
import json
import os
import shutil
import subprocess
import tempfile
import unittest

SCRIPT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "migrate-agentos")


class Migrate(unittest.TestCase):
    def setUp(self):
        self.root = tempfile.mkdtemp(prefix="adk-migrate-", dir="/var/tmp")
        self.src = os.path.join(self.root, "from")
        self.to = os.path.join(self.root, "to")
        os.makedirs(os.path.join(self.src, "mods/menu"))
        with open(os.path.join(self.src, "mods/menu/main.js"), "w") as f:
            f.write("stock")
        with open(os.path.join(self.src, "settings.json"), "w") as f:
            json.dump({"core": "/old/core", "zoom": 1.5}, f)

    def tearDown(self):
        shutil.rmtree(self.root)

    def run_it(self, *args):
        return subprocess.run(
            [SCRIPT, "--from", self.src, "--to", self.to, "--core", "/new/core", "--yes", *args],
            capture_output=True, text=True,
        )

    def test_copies_settings_and_points_at_the_new_core(self):
        out = self.run_it()
        self.assertEqual(out.returncode, 0, out.stderr)
        with open(os.path.join(self.to, "settings.json")) as f:
            self.assertEqual(json.load(f), {"core": "/new/core", "zoom": 1.5})
        self.assertTrue(os.path.exists(os.path.join(self.to, "mods/menu/main.js")))
        self.assertIn('HC_SESSION=agentos "/old/core" ls', out.stdout)

    def test_copies_the_install_record_with_the_mods(self):
        # Without it, the app takes every shipped mod for an edited one.
        record = {"menu": {"main.js": "abc"}}
        with open(os.path.join(self.src, "installed.json"), "w") as f:
            json.dump(record, f)
        self.assertEqual(self.run_it().returncode, 0)
        with open(os.path.join(self.to, "installed.json")) as f:
            self.assertEqual(json.load(f), record)

    def test_no_record_without_mods_or_layouts(self):
        shutil.rmtree(os.path.join(self.src, "mods"))
        with open(os.path.join(self.src, "installed.json"), "w") as f:
            f.write("{}")
        self.assertEqual(self.run_it().returncode, 0)
        self.assertFalse(os.path.exists(os.path.join(self.to, "installed.json")))

    def test_refuses_existing_settings_without_force(self):
        os.makedirs(self.to)
        with open(os.path.join(self.to, "settings.json"), "w") as f:
            f.write("{}")
        out = self.run_it()
        self.assertNotEqual(out.returncode, 0)
        with open(os.path.join(self.to, "settings.json")) as f:
            self.assertEqual(f.read(), "{}")
        self.assertEqual(self.run_it("--force").returncode, 0)

    def test_missing_source_fails_and_writes_nothing(self):
        shutil.rmtree(self.src)
        self.assertNotEqual(self.run_it().returncode, 0)
        self.assertFalse(os.path.exists(self.to))


if __name__ == "__main__":
    unittest.main()
