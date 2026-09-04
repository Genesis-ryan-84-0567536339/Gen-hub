package cli

import (
	"bytes"
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestOpsCLICommands(t *testing.T) {
	t.Run("backup command requires path argument", func(t *testing.T) {
		cmd := NewBackupCommand()
		err := cmd.Execute()
		assert.Error(t, err)
	})

	t.Run("restore command validates missing file", func(t *testing.T) {
		cmd := NewRestoreCommand()
		cmd.SetArgs([]string{"/nonexistent/backup.tar.gz"})
		err := cmd.Execute()
		assert.Error(t, err)
	})

	t.Run("update command accepts version argument", func(t *testing.T) {
		cmd := NewUpdateCommand()
		buf := new(bytes.Buffer)
		cmd.SetOut(buf)
		cmd.SetArgs([]string{"v1.0.1"})
		err := cmd.Execute()
		assert.NoError(t, err)
	})
}
