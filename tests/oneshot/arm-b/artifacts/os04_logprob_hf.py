#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""os04_logprob_hf.py —— 采集 claim / decoy 的逐 token NLL，喂给 os04_verify.py lr。

需要：授权权重或你自己部署的本地模型 + transformers/torch。
本会话（2026-09-28）无 GPU 与 TARGET_MODEL 权重，只做了 py_compile 语法检查，未运行。

用法：
  python3 os04_logprob_hf.py --model TARGET_MODEL --text claim.txt --out claim.tsv --as-system
  python3 os04_logprob_hf.py --model TARGET_MODEL --text decoy.txt --out decoy.tsv --as-system

--as-system 很关键：把文本放进系统槽并按目标模型真实的 chat_template 渲染，
否则你量到的是「这段文本作为用户消息」的似然，与 claim 的语境不符。
"""

import argparse
import sys


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", required=True, help="本地路径或 HF id（需已授权/已下载）")
    ap.add_argument("--text", required=True)
    ap.add_argument("--out", required=True, help="TSV: token<TAB>nll")
    ap.add_argument("--as-system", action="store_true", help="按 chat_template 放进 system 槽")
    ap.add_argument("--device", default="auto")
    args = ap.parse_args()

    try:
        import torch
        from transformers import AutoModelForCausalLM, AutoTokenizer
    except ImportError as e:  # 依赖缺失时给可执行的补救命令
        print("缺少依赖: %s\n安装: python3 -m pip install torch transformers" % e, file=sys.stderr)
        return 2

    tok = AutoTokenizer.from_pretrained(args.model)
    model = AutoModelForCausalLM.from_pretrained(
        args.model, torch_dtype="auto", device_map=args.device)
    model.eval()

    text = open(args.text, encoding="utf-8").read()
    if args.as_system:
        rendered = tok.apply_chat_template(
            [{"role": "system", "content": text}], tokenize=False,
            add_generation_prompt=False)
        # 真实管道里 system 槽常被模板前后包裹，这里按渲染结果整段计分。
        prefix_ids = []
    else:
        rendered, prefix_ids = text, tok(text)["input_ids"][:-1] if False else []

    enc = tok(rendered, return_tensors="pt").to(model.device)
    with torch.no_grad():
        logits = model(**enc).logits
    logp = torch.log_softmax(logits.float(), dim=-1)
    ids = enc["input_ids"][0]
    with open(args.out, "w", encoding="utf-8") as fh:
        fh.write("#token\tnll\t(生成自 %s, as_system=%s)\n" % (args.model, args.as_system))
        for i in range(1, len(ids)):
            nll = -logp[0, i - 1, ids[i]].item()
            piece = tok.convert_ids_to_tokens([ids[i].item()])[0]
            fh.write("%s\t%.6f\n" % (piece.replace("\t", " ").replace("\n", "\\n"), nll))
    print("wrote %s (%d tokens)" % (args.out, max(0, len(ids) - 1)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
