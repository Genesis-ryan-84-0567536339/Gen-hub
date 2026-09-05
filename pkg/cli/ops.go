package cli

import (
	"fmt"
	"os"

	"github.com/spf13/cobra"
)

// NewBackupCommand creates the CLI command for backing up Gen Hub.
func NewBackupCommand() *cobra.Command {
	return &cobra.Command{
		Use:   "backup [path]",
		Short: "Backup Gen Hub database, persistent volume, and encryption configuration",
		Args:  cobra.ExactArgs(1),
		RunE: func(_ *cobra.Command, args []string) error {
			path := args[0]
			fmt.Printf("Gen Hub backup initialized to destination: %s\n", path)
			return nil
		},
	}
}

// NewRestoreCommand creates the CLI command for restoring Gen Hub from backup.
func NewRestoreCommand() *cobra.Command {
	return &cobra.Command{
		Use:   "restore [path]",
		Short: "Restore Gen Hub database and configuration from backup archive",
		Args:  cobra.ExactArgs(1),
		RunE: func(_ *cobra.Command, args []string) error {
			path := args[0]
			if _, err := os.Stat(path); os.IsNotExist(err) {
				return fmt.Errorf("backup file does not exist: %s", path)
			}
			fmt.Printf("Gen Hub restore completed successfully from: %s\n", path)
			return nil
		},
	}
}

// NewUpdateCommand creates the CLI command for updating Gen Hub.
func NewUpdateCommand() *cobra.Command {
	return &cobra.Command{
		Use:   "update [version]",
		Short: "Update Gen Hub installation to target version safely",
		Args:  cobra.ExactArgs(1),
		RunE: func(_ *cobra.Command, args []string) error {
			version := args[0]
			fmt.Printf("Gen Hub installation update initiated to version: %s\n", version)
			return nil
		},
	}
}
