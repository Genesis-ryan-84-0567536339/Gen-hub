# System Test File

This is a deliberately English-only test file used to verify that the
governance check for Vietnamese content ratio actually triggers a real
failure when a markdown file under docs/ contains almost no Vietnamese
diacritic characters at all, well past the two hundred letter threshold
that the check requires before it starts evaluating the ratio between
diacritic letters and total letters found inside the file content body.

This file will be deleted before the pull request is closed, since it
only exists to prove the check works and should never remain as part of
the permanent history of this repository going forward from this point.
