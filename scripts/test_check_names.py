"""Tests for scripts/check-names: python3 -I -m unittest scripts/test_check_names.py"""
import os
import shutil
import subprocess
import tempfile
import unittest

SCRIPT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "check-names")


class CheckNames(unittest.TestCase):
    def setUp(self):
        self.root = tempfile.mkdtemp(prefix="adk-names-", dir="/var/tmp")
        os.makedirs(os.path.join(self.root, "scripts"))
        # Copy script and empty allowlist into temp repo
        shutil.copy(SCRIPT, os.path.join(self.root, "scripts", "check-names"))
        with open(os.path.join(self.root, "scripts", "names-allow.txt"), "w") as f:
            f.write("# path<TAB>exact substring<TAB>why\n")
        # Initialize git repo
        subprocess.run(["git", "init"], cwd=self.root, capture_output=True, check=True)
        subprocess.run(["git", "config", "user.email", "test@test.com"], cwd=self.root, capture_output=True, check=True)
        subprocess.run(["git", "config", "user.name", "Test"], cwd=self.root, capture_output=True, check=True)

    def tearDown(self):
        shutil.rmtree(self.root)

    def write_file(self, path, content):
        """Write a file and git add it"""
        full_path = os.path.join(self.root, path)
        os.makedirs(os.path.dirname(full_path), exist_ok=True)
        with open(full_path, "w") as f:
            f.write(content)
        subprocess.run(["git", "add", path], cwd=self.root, capture_output=True, check=True)

    def write_allowlist(self, lines):
        """Append lines to names-allow.txt"""
        with open(os.path.join(self.root, "scripts", "names-allow.txt"), "a") as f:
            for line in lines:
                f.write(line + "\n")

    def run_check(self):
        """Run check-names in the temp repo"""
        return subprocess.run(
            ["scripts/check-names"],
            cwd=self.root,
            capture_output=True,
            text=True,
        )

    def test_clean_tree_passes(self):
        """Clean tree with only AGENTDECK_HOME passes"""
        self.write_file("app/src/a.rs", 'std::env::var("AGENTDECK_HOME")')
        out = self.run_check()
        self.assertEqual(out.returncode, 0)
        self.assertIn("check-names: clean", out.stdout)

    def test_upstream_env_var_fails(self):
        """HERDR_APP_HOME in code fails"""
        self.write_file("app/src/a.rs", 'std::env::var("HERDR_APP_HOME")')
        out = self.run_check()
        self.assertEqual(out.returncode, 1)
        self.assertIn("app/src/a.rs:1:", out.stdout)

    def test_allowlisted_hit_passes(self):
        """Allowlisted hit passes"""
        self.write_file("app/src/a.rs", 'std::env::var("HERDR_APP_HOME")')
        self.write_allowlist(["app/src/a.rs\tHERDR_APP_HOME\ttest"])
        out = self.run_check()
        self.assertEqual(out.returncode, 0)

    def test_kept_reporter_vars_pass(self):
        """HC_TERMINAL_ID and HC_TERMINAL_SOCKET pass (kept on purpose)"""
        self.write_file("app/src/a.rs", 'std::env::var("HC_TERMINAL_ID")')
        self.write_file("app/src/b.rs", 'std::env::var("HC_TERMINAL_SOCKET")')
        out = self.run_check()
        self.assertEqual(out.returncode, 0)
        self.assertIn("check-names: clean", out.stdout)

    def test_markdown_is_checked(self):
        """Markdown files are checked"""
        self.write_file("app/docs/x.md", 'Run `herdr-app ls` to see sessions.')
        out = self.run_check()
        self.assertEqual(out.returncode, 1)
        self.assertIn("app/docs/x.md:1:", out.stdout)


if __name__ == "__main__":
    unittest.main()
