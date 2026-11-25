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
        """Write a file, git add it, and commit it"""
        full_path = os.path.join(self.root, path)
        os.makedirs(os.path.dirname(full_path), exist_ok=True)
        with open(full_path, "w") as f:
            f.write(content)
        subprocess.run(["git", "add", path], cwd=self.root, capture_output=True, check=True)
        subprocess.run(["git", "commit", "-m", f"add {path}"], cwd=self.root, capture_output=True, check=True)

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

    def test_hc_session_fails(self):
        """HC_SESSION alone in a file fails"""
        self.write_file("app/src/a.rs", 'HC_SESSION=x')
        out = self.run_check()
        self.assertEqual(out.returncode, 1)
        self.assertIn("app/src/a.rs:1:", out.stdout)

    def test_hc_socket_fails(self):
        """HC_SOCKET alone in a file fails"""
        self.write_file("app/src/a.rs", 'HC_SOCKET')
        out = self.run_check()
        self.assertEqual(out.returncode, 1)
        self.assertIn("app/src/a.rs:1:", out.stdout)

    def test_home_herdr_fails(self):
        """~/.herdr/worktrees in a file fails"""
        self.write_file("app/defaults/AGENTS.md", '`~/.herdr/worktrees` is the path')
        out = self.run_check()
        self.assertEqual(out.returncode, 1)
        self.assertIn("app/defaults/AGENTS.md:1:", out.stdout)

    def test_kept_reporter_vars_pass(self):
        """HC_TERMINAL_ID, HC_TERMINAL_SOCKET, HC_SESSIONS_DIR pass (kept on purpose)"""
        self.write_file("app/src/a.rs", 'std::env::var("HC_TERMINAL_ID")')
        self.write_file("app/src/b.rs", 'std::env::var("HC_TERMINAL_SOCKET")')
        self.write_file("app/src/c.rs", 'std::env::var("HC_SESSIONS_DIR")')
        out = self.run_check()
        self.assertEqual(out.returncode, 0)
        self.assertIn("check-names: clean", out.stdout)

    def test_markdown_is_checked(self):
        """Markdown files are checked"""
        self.write_file("app/docs/x.md", 'Run `herdr-app ls` to see sessions.')
        out = self.run_check()
        self.assertEqual(out.returncode, 1)
        self.assertIn("app/docs/x.md:1:", out.stdout)

    def test_bare_hc_in_brackets_fails(self):
        """[hc] prefix in code fails"""
        self.write_file("core/crates/herdr-core/src/a.rs", 'println!("[hc] started")')
        out = self.run_check()
        self.assertEqual(out.returncode, 1)
        self.assertIn("core/crates/herdr-core/src/a.rs:1:", out.stdout)

    def test_hc_socket_and_config_fail(self):
        """HC_SOCKET and .config/herdr-core fail"""
        self.write_file("app/src/a.rs", 'std::env::var("HC_SOCKET")')
        out = self.run_check()
        self.assertEqual(out.returncode, 1)
        self.assertIn("app/src/a.rs:1:", out.stdout)

        self.write_file("app/src/b.rs", 'path.join(".config/herdr-core")')
        out = self.run_check()
        self.assertEqual(out.returncode, 1)
        self.assertIn("app/src/b.rs:1:", out.stdout)

    def assert_fails(self, path, content):
        self.write_file(path, content)
        out = self.run_check()
        self.assertEqual(out.returncode, 1, out.stdout)
        self.assertIn(f"{path}:1:", out.stdout)

    def assert_clean(self, path, content):
        self.write_file(path, content)
        out = self.run_check()
        self.assertEqual(out.returncode, 0, out.stdout)
        self.assertIn("check-names: clean", out.stdout)

    def test_hc_tag_fails(self):
        self.assert_fails("core/crates/herdr-core/src/a.rs", "/// `<hc>` tags")

    def test_hc_word_in_schema_fails(self):
        self.assert_fails("core/schema/hc.openrpc.json", '"The hc session there"')

    def test_hc_word_in_core_docs_fails(self):
        self.assert_fails("core/docs/via/x.py", '"""Reach it with hc: hc machine add"""')

    def test_released_schema_ignored(self):
        self.assert_clean("core/schema/released.openrpc.json", '"The hc session there"')

    def test_hc_in_file_names_passes(self):
        self.assert_clean("core/docs/x.md", "See `schema/hc.openrpc.json` and herdr-core/hc.")

    def test_upstream_shot_name_fails(self):
        self.assert_fails("app/src/a.rs", 'unwrap_or("herdr-shot.png")')

    def test_shot_temp_name_passes(self):
        self.assert_clean("app/src/a.rs", 'format!(".herdr-shot-{}.png", id)')

    def test_agentos_fails(self):
        self.assert_fails("app/defaults/a.d.ts", "(AgentOS has none)")

    def test_to_hc_version_fails(self):
        self.assert_fails("app/defaults/a.js", "` to hc ${v}`")

    def test_herdr_word_in_guides_fails(self):
        self.assert_fails("app/defaults/AGENTS.md", "# Herdr app")

    def test_herdr_word_in_skill_fails(self):
        self.assert_fails("core/crates/herdr-core/src/SKILL.md", "open Herdr there")

    def test_herdr_word_in_code_passes(self):
        self.assert_clean("app/src/a.rs", "// like Herdr")

    def test_herdr_label_in_guide_passes(self):
        self.assert_clean("app/defaults/AGENTS.md", "`herdr.space=<id>`")


if __name__ == "__main__":
    unittest.main()
