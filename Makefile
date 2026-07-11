VSIX    := mr-behavior-lens.vsix
# ใช้ `code` จาก PATH ถ้ามี ไม่งั้น fallback ไปที่ตัวใน VSCode.app
CODE    := $(shell command -v code 2>/dev/null || echo "/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code")

.PHONY: all deps compile typecheck watch package install uninstall clean

all: install

# npm dependencies
deps:
	npm install

# typecheck + bundle ไป dist/
compile: deps
	npm run compile

typecheck:
	npm run typecheck

watch:
	node esbuild.js --watch

# package เป็น .vsix (ใช้ vsce ผ่าน npx ไม่ต้อง install global)
package: compile
	npx --yes @vscode/vsce package --allow-missing-repository -o $(VSIX)

# install เข้า VSCode
install: package
	"$(CODE)" --install-extension $(VSIX)
	@echo "✅ ติดตั้งแล้ว — reload VSCode window เพื่อใช้งาน"

uninstall:
	"$(CODE)" --uninstall-extension sinjmenaruchi.mr-behavior-lens

clean:
	rm -rf dist $(VSIX)
