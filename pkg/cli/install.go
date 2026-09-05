package cli

import (
	"fmt"
	"net"
	"os"
	"os/exec"
	"syscall"

	"github.com/AlecAivazis/survey/v2"
	"github.com/spf13/cobra"
)

// getLocalIP attempts to detect the local primary IPv4 address of the server.
func getLocalIP() string {
	addrs, err := net.InterfaceAddrs()
	if err != nil {
		return "127.0.0.1"
	}
	for _, address := range addrs {
		if ipnet, ok := address.(*net.IPNet); ok && !ipnet.IP.IsLoopback() {
			if ipnet.IP.To4() != nil {
				return ipnet.IP.String()
			}
		}
	}
	return "127.0.0.1"
}

// NewInstallTUICommand creates an interactive TUI installer for Gen Hub.
func NewInstallTUICommand() *cobra.Command {
	return &cobra.Command{
		Use:   "install",
		Short: "Interactive TUI installer for Gen Hub (First-run wizard)",
		RunE: func(_ *cobra.Command, _ []string) error {
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

			var autoStart bool
			promptAutoStart := &survey.Confirm{
				Message: "Tự động khởi động Server Gen Hub ngay sau khi cài đặt?",
				Default: true,
			}
			if err := survey.AskOne(promptAutoStart, &autoStart); err != nil {
				autoStart = true
			}

			localIP := getLocalIP()

			fmt.Println("\n[1/5] 🔍 Kiểm tra điều kiện hệ thống...")
			fmt.Println("[2/5] 🌐 Kiểm tra cú pháp Domain & DNS...")
			fmt.Println("[3/5] 🔑 Khởi tạo Secret ngẫu nhiên & Vault Encryption...")
			fmt.Println("[4/5] 🚀 Khởi tạo Designated Composite Hub (genhub.io/front-door=true)...")
			fmt.Printf("[5/5] ✨ Hoàn tất cài đặt cho domain: %s\n\n", domain)

			scheme := "http"
			if useHTTPS && domain != "localhost" {
				scheme = "https"
			}

			fmt.Println("==================================================================")
			fmt.Printf(" 🎉 Gen Hub v1 Cài đặt hoàn tất thành công!\n")
			fmt.Println("==================================================================")
			if domain == "localhost" {
				fmt.Printf(" 🖥️  Web Admin UI (Cục bộ):     http://localhost:8080\n")
				fmt.Printf(" 🤖  MCP Endpoint:              http://localhost:8080/mcp\n")
			} else {
				fmt.Printf(" 📍 IP Máy chủ cục bộ (LAN IP): %s\n", localIP)
				fmt.Printf(" 🖥️  Web Admin UI:              %s://%s:8080\n", scheme, domain)
				fmt.Printf(" 🤖  MCP Endpoint:              %s://%s:8080/mcp\n", scheme, domain)
			}
			fmt.Println("------------------------------------------------------------------")

			if autoStart {
				fmt.Println(" 🚀 ĐANG TỰ ĐỘNG KHỞI ĐỘNG SERVER GEN HUB...")
				executable, err := os.Executable()
				if err != nil {
					executable = "./bin/gen-hub"
				}
				logFile, logErr := os.OpenFile("gen-hub-server.log", os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0644)
				devNull, _ := os.Open(os.DevNull)

				cmd := exec.Command(executable, "server")
				cmd.Stdin = devNull
				if logErr == nil {
					cmd.Stdout = logFile
					cmd.Stderr = logFile
				}
				cmd.SysProcAttr = &syscall.SysProcAttr{Setsid: true}

				if err := cmd.Start(); err != nil {
					fmt.Printf("  ⚠️ Không thể tự khởi động server: %v\n", err)
					fmt.Println("  👉 Hãy chạy thủ công: ./bin/gen-hub server")
				} else {
					fmt.Printf("  ✅ Server đã được khởi động thành công (PID: %d)!\n", cmd.Process.Pid)
					fmt.Println("  📄 Log server được ghi tại: gen-hub-server.log")
					fmt.Printf("  🌐 Bạn có thể mở ngay trình duyệt tại: %s://%s:8080\n", scheme, domain)
				}
			} else {
				fmt.Println(" 🚀 LỆNH KHỞI ĐỘNG HỆ THỐNG THỦ CÔNG:")
				fmt.Println("  👉 Chạy Server Gen Hub:")
				fmt.Println("     ./bin/gen-hub server")
			}
			fmt.Println("==================================================================")

			return nil
		},
	}
}
