export function pickFiles(options: { readonly accept: string; readonly multiple: boolean; readonly maxItems?: number }): Promise<readonly File[]> {
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = options.accept;
    input.multiple = options.multiple;
    input.hidden = true;
    const finish = (files: readonly File[] | undefined, cancelled: boolean) => {
      input.remove();
      if (cancelled || !files || files.length === 0) {
        reject(Object.assign(new Error("已取消选择"), { code: "ERR_MEDIA_SELECTION_CANCELLED" }));
        return;
      }
      resolve(options.maxItems ? files.slice(0, options.maxItems) : files);
    };
    input.addEventListener("change", () => finish([...(input.files ?? [])], false));
    input.addEventListener("cancel", () => finish(undefined, true));
    document.body.append(input);
    input.click();
  });
}
