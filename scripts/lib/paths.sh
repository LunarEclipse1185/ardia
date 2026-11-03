chromium_src="${CHROMIUM_SRC:-$HOME/chromium-build/chromium_git/chromium/src}"
case "$(uname -m)" in
  x86_64) chromium_out="out/Release_GN_x64" ;;
  *) chromium_out="out/Release_GN_arm64" ;;
esac
chromium_framework="${ARDIACORE_FRAMEWORK:-$chromium_src/$chromium_out/Chromium Framework.framework}"
