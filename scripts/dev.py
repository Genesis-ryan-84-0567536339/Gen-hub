#!/usr/bin/env python3
import getpass,json,subprocess
username=input('Owner local: ').strip();password=getpass.getpass('Password (>=12 ký tự): ')
if password!=getpass.getpass('Nhập lại: '):raise SystemExit('Không khớp')
subprocess.run(['node','server/admin.mjs','create-owner'],input=json.dumps({'username':username,'password':password}),text=True,check=True)
print('Chạy npm start rồi mở http://127.0.0.1:3080')
