package cli

import (
	"fmt"
	"net"

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

			var useTunnel bool
			promptTunnel := &survey.Confirm{
				Message: "Máy chủ ở đằng sau NAT / Router mạng nhà (Cần dùng Tunnel để public ra Internet)?",
				Default: false,
			}
			if err := survey.AskOne(promptTunnel, &useTunnel); err != nil {
				return err
			}

			localIP := getLocalIP()

			fmt.Println("\n[1/5] 🔍 Kiểm tra điều kiện hệ thống...")
			fmt.Println("[2/5] 🌐 Kiểm tra cú pháp Domain & DNS...")
			fmt.Println("[3/5] 🔑 Khởi tạo Secret ngẫu nhiên & Vault Encryption...")
			fmt.Println("[4/5] 🚀 Khởi tạo Designated Composite Hub (genhub.io/front-door=true)...")
			fmt.Printf("[5/5] ✨ Hoàn tất cài đặt cho domain: %s\n\n", domain)

			scheme := "http"
			if useHTTPS {
				scheme = "https"
			}

			fmt.Println("==================================================================")
			fmt.Printf(" 🎉 Gen Hub v1 Cài đặt hoàn tất thành công!\n")
			fmt.Println("==================================================================")
			if domain == "localhost" {
				fmt.Printf(" 🖥️  Web Admin UI (Cục bộ):     http://localhost:8080\n")
				fmt.Printf(" 🤖  MCP Endpoint:              http://localhost:8080/mcp\n")
				fmt.Println("------------------------------------------------------------------")
				fmt.Println(" 🚀 3 BƯỚC TRUY CẬP VÀ CẤU HÌNH TIẾP THEO:")
				fmt.Println("  1️⃣  Khởi động Server ngay:")
				fmt.Println("      ./bin/gen-hub server")
				fmt.Println("  2️⃣  Mở Web Admin UI trên Trình duyệt:")
				fmt.Println("      http://localhost:8080")
				fmt.Println("  3️⃣  Cấu hình Tên miền (Domain), HTTPS & Tunnel từ Web GUI hoặc CLI:")
				fmt.Println("      - Đổi Tên miền công cộng trong Web Admin UI -> Domain Settings")
				fmt.Println("      - Mở Tunnel kết nối ra ngoài Internet (khi ở sau NAT/Router):")
				fmt.Println("        ./bin/gen-hub tunnel --url http://localhost:8080")
				fmt.Println("      - Cấu hình Caddy Reverse Proxy (Tự động cấp SSL Cổng 80/443)")
			} else {
				fmt.Printf(" 📍 IP Máy chủ cục bộ (LAN IP): %s\n", localIP)
				fmt.Printf(" 🖥️  Web Admin UI:              %s://%s:8080\n", scheme, domain)
				fmt.Printf(" 🤖  MCP Endpoint:              %s://%s:8080/mcp\n", scheme, domain)
				fmt.Println("------------------------------------------------------------------")
				fmt.Println(" 📌 HƯỚNG DẪN CẤU HÌNH KẾT NỐI (NETWORK & DNS CONFIGURATION):")
				fmt.Printf("  1. Trỏ DNS A Record: Vui lòng truy cập trang quản lý DNS tên miền '%s'\n", domain)
				fmt.Printf("     và tạo bản ghi:  A  ->  <IP_PUBLIC_CỦA_MÁY_CHỦ> (hoặc IP: %s)\n", localIP)
				fmt.Println("     (Nếu thử nghiệm nội bộ, thêm dòng sau vào /etc/hosts: ")
				fmt.Printf("      %s  %s)\n", localIP, domain)
				if useHTTPS {
					fmt.Println("  2. Cấu hình HTTPS & Firewall:")
					fmt.Println("     - Mở cổng 80 & 443 trên Firewall/Router để Let's Encrypt tự động xác thực SSL.")
					fmt.Println("     - Caddy/Gen Hub sẽ tự động cấp chứng chỉ TLS công cộng.")
				}
				if useTunnel {
					fmt.Println("  3. Kết nối Tunnel (Khi nằm sau NAT / Router mạng nhà không có IP Tĩnh):")
					fmt.Println("     - Mở Tunnel: ./bin/gen-hub tunnel --url http://localhost:8080")
				}
				fmt.Println("------------------------------------------------------------------")
				fmt.Println(" 🚀 LỆNH KHỞI ĐỘNG HỆ THỐNG:")
				fmt.Println("  👉 Chạy Server Gen Hub ngay:")
				fmt.Println("     ./bin/gen-hub server")
			}
			fmt.Println("==================================================================")

			return nil
		},
	}
}


