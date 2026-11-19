"""Tests for scripts/release-check: python3 -I -m unittest scripts/test_release_check.py"""
import os
import shutil
import subprocess
import tempfile
import unittest

SCRIPT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "release-check")
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


class ReleaseCheck(unittest.TestCase):
    def setUp(self):
        self.root = tempfile.mkdtemp(prefix="adk-release-", dir="/var/tmp")
        self.version_file = os.path.join(self.root, "VERSION")
        self.changelog = os.path.join(self.root, "CHANGELOG.md")

    def tearDown(self):
        shutil.rmtree(self.root)

    def run_it(self, tag, *args):
        return subprocess.run(
            [SCRIPT, tag, "--root", self.root, *args],
            capture_output=True, text=True,
        )

    def test_matching_tag_passes_and_writes_notes(self):
        with open(self.version_file, "w") as f:
            f.write("0.1.0\n")
        with open(self.changelog, "w") as f:
            f.write("# AgentDeck changelog\n\n")
            f.write("## agentdeck-v0.1.0 (2026-11-19)\n")
            f.write("On herdr-app 0.1.14 and herdr-core 0.1.19.\n\n")
            f.write("- First feature\n")
            f.write("- Second feature\n\n")
            f.write("## agentdeck-v0.0.1 (2026-11-01)\n")
            f.write("Old release.\n")

        notes_file = os.path.join(self.root, "notes.md")
        out = self.run_it("agentdeck-v0.1.0", "--notes", notes_file)
        self.assertEqual(out.returncode, 0, out.stderr)

        with open(notes_file) as f:
            notes = f.read()
        self.assertIn("On herdr-app 0.1.14 and herdr-core 0.1.19.", notes)
        self.assertIn("- First feature", notes)
        self.assertIn("- Second feature", notes)
        self.assertNotIn("## agentdeck-v0.0.1", notes)

    def test_tag_not_matching_version_fails(self):
        with open(self.version_file, "w") as f:
            f.write("0.1.0\n")
        with open(self.changelog, "w") as f:
            f.write("# AgentDeck changelog\n\n")
            f.write("## agentdeck-v0.2.0 (2026-11-19)\n")
            f.write("Content.\n")

        out = self.run_it("agentdeck-v0.2.0")
        self.assertEqual(out.returncode, 1)
        self.assertIn("VERSION says 0.1.0", out.stderr)

    def test_missing_changelog_section_fails(self):
        with open(self.version_file, "w") as f:
            f.write("0.1.0\n")
        with open(self.changelog, "w") as f:
            f.write("# AgentDeck changelog\n\n")
            f.write("## agentdeck-v0.2.0 (2026-11-19)\n")
            f.write("Wrong version.\n")

        out = self.run_it("agentdeck-v0.1.0")
        self.assertEqual(out.returncode, 1)
        self.assertIn('no "## agentdeck-v0.1.0" in CHANGELOG.md', out.stderr)

    def write(self, changelog):
        with open(self.version_file, "w") as f:
            f.write("0.1.0\n")
        with open(self.changelog, "w") as f:
            f.write(changelog)

    def test_longer_version_header_does_not_count(self):
        self.write("# AgentDeck changelog\n\n## agentdeck-v0.1.01 (2026-11-19)\nContent.\n")
        out = self.run_it("agentdeck-v0.1.0")
        self.assertEqual(out.returncode, 1)
        self.assertIn('no "## agentdeck-v0.1.0" in CHANGELOG.md', out.stderr)

    def test_deeper_heading_does_not_count(self):
        self.write("# AgentDeck changelog\n\n### agentdeck-v0.1.0 (2026-11-19)\nContent.\n")
        out = self.run_it("agentdeck-v0.1.0")
        self.assertEqual(out.returncode, 1)
        self.assertIn('no "## agentdeck-v0.1.0" in CHANGELOG.md', out.stderr)

    def test_bare_header_counts(self):
        self.write("# AgentDeck changelog\n\n## agentdeck-v0.1.0\nContent.\n")
        out = self.run_it("agentdeck-v0.1.0")
        self.assertEqual(out.returncode, 0, out.stderr)

    def test_empty_section_fails(self):
        self.write("# AgentDeck changelog\n\n## agentdeck-v0.1.0 (2026-11-19)\n\n## agentdeck-v0.0.1\nOld.\n")
        out = self.run_it("agentdeck-v0.1.0")
        self.assertEqual(out.returncode, 1)
        self.assertIn("is empty", out.stderr)

    def test_bad_tag_shape_fails(self):
        with open(self.version_file, "w") as f:
            f.write("0.1.0\n")
        with open(self.changelog, "w") as f:
            f.write("# AgentDeck changelog\n\n")
            f.write("## agentdeck-v0.1.0 (2026-11-19)\n")
            f.write("Content.\n")

        out1 = self.run_it("v0.1.0")
        self.assertEqual(out1.returncode, 1)

        out2 = self.run_it("agentdeck-v0.1")
        self.assertEqual(out2.returncode, 1)

    def test_the_repo_itself_passes(self):
        version_file = os.path.join(REPO, "VERSION")
        if not os.path.exists(version_file):
            self.skipTest("VERSION not yet created")

        with open(version_file) as f:
            version = f.read().strip()

        out = subprocess.run(
            [SCRIPT, f"agentdeck-v{version}"],
            capture_output=True, text=True, cwd=REPO,
        )
        self.assertEqual(out.returncode, 0, out.stderr)


if __name__ == "__main__":
    unittest.main()
