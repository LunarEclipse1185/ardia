chromium_src="${CHROMIUM_SRC:-$HOME/chromium-build/chromium_git/chromium/src}"
case "${TARGET_CPU:-$(uname -m)}" in
  x64 | x86_64) chromium_out="out/${GN_OUT_CONFIGS:-Release_GN_x64}" ;;
  *) chromium_out="out/${GN_OUT_CONFIGS:-Release_GN_arm64}" ;;
esac
chromium_framework="${ARDIACORE_FRAMEWORK:-$chromium_src/$chromium_out/Chromium Framework.framework}"
