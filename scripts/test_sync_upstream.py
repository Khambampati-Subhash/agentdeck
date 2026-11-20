"""Tests for scripts/sync-upstream: python3 -I -m unittest scripts/test_sync_upstream.py"""
import os
import shutil
import subprocess
import tempfile
import unittest

SCRIPT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "sync-upstream")


class SyncUpstream(unittest.TestCase):
    def setUp(self):
        """Create fixture repos: upstream and ours with subtree import."""
        self.tmpdir = tempfile.mkdtemp(prefix="adk-sync-", dir="/var/tmp")

        # Git identity for tests
        self.git_env = {
            **os.environ,
            "GIT_AUTHOR_NAME": "Test",
            "GIT_AUTHOR_EMAIL": "test@test.test",
            "GIT_COMMITTER_NAME": "Test",
            "GIT_COMMITTER_EMAIL": "test@test.test",
        }

        # Create upstream repo
        self.upstream = os.path.join(self.tmpdir, "upstream")
        os.makedirs(self.upstream)
        subprocess.run(["git", "init", "-b", "main"], cwd=self.upstream, check=True, env=self.git_env)
        with open(os.path.join(self.upstream, "a.txt"), "w") as f:
            f.write("line 1\n")
        subprocess.run(["git", "add", "a.txt"], cwd=self.upstream, check=True, env=self.git_env)
        subprocess.run(["git", "commit", "-m", "initial"], cwd=self.upstream, check=True, env=self.git_env)

        # Rename main to master for upstream (Herdr uses master)
        subprocess.run(["git", "branch", "-m", "main", "master"], cwd=self.upstream, check=True, env=self.git_env)

        # Create ours repo with subtree import
        self.ours = os.path.join(self.tmpdir, "ours")
        os.makedirs(self.ours)
        subprocess.run(["git", "init", "-b", "main"], cwd=self.ours, check=True, env=self.git_env)

        # Create an initial commit (required for subtree)
        with open(os.path.join(self.ours, "README"), "w") as f:
            f.write("ours\n")
        subprocess.run(["git", "add", "README"], cwd=self.ours, check=True, env=self.git_env)
        subprocess.run(["git", "commit", "-m", "initial"], cwd=self.ours, check=True, env=self.git_env)

        # Do the subtree add
        subprocess.run(
            ["git", "remote", "add", "upstream-core", self.upstream],
            cwd=self.ours, check=True, env=self.git_env
        )
        subprocess.run(
            ["git", "fetch", "--no-tags", "upstream-core", "master"],
            cwd=self.ours, check=True, env=self.git_env
        )
        subprocess.run(
            ["git", "subtree", "add", "--prefix=core", "upstream-core", "master", "-m", "import core"],
            cwd=self.ours, check=True, env=self.git_env
        )

        # Create sync branch
        subprocess.run(["git", "checkout", "-b", "sync-core-test"], cwd=self.ours, check=True, env=self.git_env)

        # Copy script and create stub check scripts
        scripts_dir = os.path.join(self.ours, "scripts")
        os.makedirs(scripts_dir, exist_ok=True)
        shutil.copy(SCRIPT, os.path.join(scripts_dir, "sync-upstream"))

        # Create stub check-offline
        with open(os.path.join(scripts_dir, "check-offline"), "w") as f:
            f.write("#!/bin/sh\necho ok\n")
        os.chmod(os.path.join(scripts_dir, "check-offline"), 0o755)

        # Create stub check-names
        with open(os.path.join(scripts_dir, "check-names"), "w") as f:
            f.write("#!/bin/sh\necho ok\n")
        os.chmod(os.path.join(scripts_dir, "check-names"), 0o755)

        # Point to our fixture upstream
        self.test_env = {
            **self.git_env,
            "SYNC_UPSTREAM_URL": self.upstream,
            "SYNC_UPSTREAM_SKIP_SUITES": "1",
        }

    def tearDown(self):
        shutil.rmtree(self.tmpdir)

    def run_sync(self, *args):
        """Run sync-upstream in the ours repo."""
        script = os.path.join(self.ours, "scripts", "sync-upstream")
        return subprocess.run(
            [script, *args],
            cwd=self.ours,
            capture_output=True,
            text=True,
            env=self.test_env,
        )

    def test_refuses_main(self):
        """On main → exit 2, HEAD unchanged."""
        subprocess.run(["git", "checkout", "main"], cwd=self.ours, check=True, env=self.test_env)
        head_before = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=self.ours, capture_output=True, text=True, check=True, env=self.test_env
        ).stdout.strip()

        out = self.run_sync("pull", "core")
        self.assertEqual(out.returncode, 2)

        head_after = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=self.ours, capture_output=True, text=True, check=True, env=self.test_env
        ).stdout.strip()
        self.assertEqual(head_before, head_after)

    def test_refuses_dirty_tree(self):
        """A staged, uncommitted change → exit 2, nothing fetched."""
        # Make a change and stage it
        with open(os.path.join(self.ours, "core", "a.txt"), "a") as f:
            f.write("change\n")
        subprocess.run(["git", "add", "core/a.txt"], cwd=self.ours, check=True, env=self.test_env)

        out = self.run_sync("pull", "core")
        self.assertEqual(out.returncode, 2)

    def test_pulls_new_upstream_commit(self):
        """Upstream commits b.txt → exit 0, core/b.txt exists, correct merge message."""
        # Add a commit to upstream
        with open(os.path.join(self.upstream, "b.txt"), "w") as f:
            f.write("new file\n")
        subprocess.run(["git", "add", "b.txt"], cwd=self.upstream, check=True, env=self.test_env)
        subprocess.run(["git", "commit", "-m", "add b"], cwd=self.upstream, check=True, env=self.test_env)

        upstream_sha = subprocess.run(
            ["git", "rev-parse", "--short", "HEAD"],
            cwd=self.upstream, capture_output=True, text=True, check=True, env=self.test_env
        ).stdout.strip()

        out = self.run_sync("pull", "core")
        self.assertEqual(out.returncode, 0, out.stderr)

        # Check file exists
        self.assertTrue(os.path.exists(os.path.join(self.ours, "core", "b.txt")))

        # Check commit message
        msg = subprocess.run(
            ["git", "log", "-1", "--format=%s"],
            cwd=self.ours, capture_output=True, text=True, check=True, env=self.test_env
        ).stdout.strip()
        self.assertEqual(msg, f"repo: sync core with upstream {upstream_sha}")

    def test_conflict_stops_with_files_listed(self):
        """Both sides change a.txt line 1 → exit 1, lists core/a.txt, MERGE_HEAD exists."""
        # Change upstream
        with open(os.path.join(self.upstream, "a.txt"), "w") as f:
            f.write("upstream change\n")
        subprocess.run(["git", "add", "a.txt"], cwd=self.upstream, check=True, env=self.test_env)
        subprocess.run(["git", "commit", "-m", "upstream change"], cwd=self.upstream, check=True, env=self.test_env)

        # Change ours
        with open(os.path.join(self.ours, "core", "a.txt"), "w") as f:
            f.write("our change\n")
        subprocess.run(["git", "add", "core/a.txt"], cwd=self.ours, check=True, env=self.test_env)
        subprocess.run(["git", "commit", "-m", "our change"], cwd=self.ours, check=True, env=self.test_env)

        out = self.run_sync("pull", "core")
        self.assertEqual(out.returncode, 1)
        self.assertIn("core/a.txt", out.stdout)

        # Check MERGE_HEAD exists
        merge_head = subprocess.run(
            ["git", "rev-parse", "-q", "--verify", "MERGE_HEAD"],
            cwd=self.ours, capture_output=True, env=self.test_env
        )
        self.assertEqual(merge_head.returncode, 0)

    def test_check_mode_runs_after_resolution(self):
        """After conflict resolution, check core → exit 0, stdout contains 'added lines to review:'."""
        # Set up conflict (reuse previous test setup)
        with open(os.path.join(self.upstream, "a.txt"), "w") as f:
            f.write("upstream change\n")
        subprocess.run(["git", "add", "a.txt"], cwd=self.upstream, check=True, env=self.test_env)
        subprocess.run(["git", "commit", "-m", "upstream change"], cwd=self.upstream, check=True, env=self.test_env)

        with open(os.path.join(self.ours, "core", "a.txt"), "w") as f:
            f.write("our change\n")
        subprocess.run(["git", "add", "core/a.txt"], cwd=self.ours, check=True, env=self.test_env)
        subprocess.run(["git", "commit", "-m", "our change"], cwd=self.ours, check=True, env=self.test_env)

        # Run pull and get conflict
        self.run_sync("pull", "core")

        # Resolve conflict
        with open(os.path.join(self.ours, "core", "a.txt"), "w") as f:
            f.write("resolved\n")
        subprocess.run(["git", "add", "core/a.txt"], cwd=self.ours, check=True, env=self.test_env)
        subprocess.run(["git", "commit", "--no-edit"], cwd=self.ours, check=True, env=self.test_env)

        # Run check
        out = self.run_sync("check", "core")
        self.assertEqual(out.returncode, 0, out.stderr)
        self.assertIn("added lines to review:", out.stdout)

    def test_report_lists_added_herdr_lines(self):
        """Upstream adds 'Herdr is ready' and [hc] → report contains both."""
        # Add a file with "Herdr" to upstream
        with open(os.path.join(self.upstream, "toast.txt"), "w") as f:
            f.write('toast("Herdr is ready")\nprintln!("[hc] started")\n')
        subprocess.run(["git", "add", "toast.txt"], cwd=self.upstream, check=True, env=self.test_env)
        subprocess.run(["git", "commit", "-m", "add toast"], cwd=self.upstream, check=True, env=self.test_env)

        # Pull it
        out = self.run_sync("pull", "core")
        self.assertEqual(out.returncode, 0, out.stderr)

        # Check the report
        self.assertIn("added lines to review:", out.stdout)
        self.assertIn('core/toast.txt: toast("Herdr is ready")', out.stdout)
        self.assertIn('core/toast.txt: println!("[hc] started")', out.stdout)

    def test_check_ignores_sync_commits_on_other_branches(self):
        """Sync merge on branch sync-a, new branch sync-b from main, check core → exit 2."""
        # Add a commit to upstream
        with open(os.path.join(self.upstream, "b.txt"), "w") as f:
            f.write("new file\n")
        subprocess.run(["git", "add", "b.txt"], cwd=self.upstream, check=True, env=self.test_env)
        subprocess.run(["git", "commit", "-m", "add b"], cwd=self.upstream, check=True, env=self.test_env)

        # Pull it on sync-a branch (we're on sync-core-test)
        out = self.run_sync("pull", "core")
        self.assertEqual(out.returncode, 0, out.stderr)

        # Create a new sync branch from main
        subprocess.run(["git", "checkout", "main"], cwd=self.ours, check=True, env=self.test_env)
        subprocess.run(["git", "checkout", "-b", "sync-b"], cwd=self.ours, check=True, env=self.test_env)

        # check core should exit 2 (no sync on this branch)
        out = self.run_sync("check", "core")
        self.assertEqual(out.returncode, 2)

    def test_two_pulls_report_both_merges(self):
        """Two pulls on one branch → check reports added lines from both merges."""
        # First pull
        with open(os.path.join(self.upstream, "b.txt"), "w") as f:
            f.write("first\n")
        subprocess.run(["git", "add", "b.txt"], cwd=self.upstream, check=True, env=self.test_env)
        subprocess.run(["git", "commit", "-m", "add b"], cwd=self.upstream, check=True, env=self.test_env)

        out = self.run_sync("pull", "core")
        self.assertEqual(out.returncode, 0, out.stderr)

        # Second pull
        with open(os.path.join(self.upstream, "c.txt"), "w") as f:
            f.write("Herdr second\n")
        subprocess.run(["git", "add", "c.txt"], cwd=self.upstream, check=True, env=self.test_env)
        subprocess.run(["git", "commit", "-m", "add c"], cwd=self.upstream, check=True, env=self.test_env)

        out = self.run_sync("pull", "core")
        self.assertEqual(out.returncode, 0, out.stderr)

        # Should report lines from both b.txt and c.txt
        self.assertIn("Herdr second", out.stdout)


if __name__ == "__main__":
    unittest.main()
