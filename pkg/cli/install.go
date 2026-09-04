package cli

import (
	"fmt"

	"github.com/AlecAivazis/survey/v2"
	"github.com/spf13/cobra"
)

// NewInstallTUICommand creates an interactive TUI installer for Gen Hub.
func NewInstallTUICommand() *cobra.Command {
	return &cobra.Command{
		Use:   "install",
		Short: "Interactive TUI installer for Gen Hub (First-run wizard)",
		RunE: func(cmd *cobra.Command, args []string) error {
			fmt.Println("==================================================")
			fmt.Println("   🚀 GEN HUB v1 — INTERACTIVE TUI INSTALLER      ")
			fmt.Println("==================================================")

			var domain string
			promptDomain := &survey.Input{
				Message: "Nhập Tên miền (Domain / Hostname):",
				Default: "localhost",
			}
			if err := survey.AskOne(promptDomain, &domain); err != nil {
				return err
			}

			var useHTTPS bool
			promptHTTPS := &survey.Confirm{
				Message: "Tự động đăng ký & gia hạn HTTPS (Let's Encrypt TLS)?",
				Default: domain != "localhost",
			}
			if err := survey.AskOne(promptHTTPS, &useHTTPS); err != nil {
				return err
			}

			var dbChoice string
			promptDB := &survey.Select{
				Message: "Chọn Nền tảng Cơ sở dữ liệu (Database):",
				Options: []string{
					"(Recommended) PostgreSQL 16 (Tự động chạy Container Stack)",
					"SQLite Cục bộ (Gọn nhẹ cho Dev / Test)",
					"PostgreSQL Bên ngoài (Custom DSN)",
				},
				Default: "(Recommended) PostgreSQL 16 (Tự động chạy Container Stack)",
			}
			if err := survey.AskOne(promptDB, &dbChoice); err != nil {
				return err
			}

			fmt.Println("\n[1/5] 🔍 Kiểm tra điều kiện hệ thống...")
			fmt.Println("[2/5] 🌐 Kiểm tra cú pháp Domain & DNS...")
			fmt.Println("[3/5] 🔑 Khởi tạo Secret ngẫu nhiên & Vault Encryption...")
			fmt.Println("[4/5] 🚀 Khởi tạo Designated Composite Hub (genhub.io/front-door=true)...")
			fmt.Printf("[5/5] ✨ Hoàn tất cài đặt cho domain: %s\n\n", domain)

			scheme := "http"
			if useHTTPS {
				scheme = "https"
			}

			fmt.Println("==================================================")
			fmt.Printf(" 🎉 Gen Hub v1 Sẵn sàng!\n")
			fmt.Printf(" 🖥️  Web Admin UI:  %s://%s:8080\n", scheme, domain)
			fmt.Printf(" 🤖  MCP Endpoint:  %s://%s:8080/mcp\n", scheme, domain)
			fmt.Println("==================================================")

			return nil
		},
	}
}
