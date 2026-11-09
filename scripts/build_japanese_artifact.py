"""japanese/ 페이지를 외부 파일 없는 단일 HTML 조각으로 묶습니다 (Artifact 배포용)."""
import pathlib, re, sys
src = pathlib.Path(__file__).resolve().parent.parent / "japanese"
out = pathlib.Path(sys.argv[1])
html = (src / "index.html").read_text(encoding="utf-8")
head = re.search(r"<head>(.*?)</head>", html, re.S).group(1)
body = re.search(r"<body>(.*?)</body>", html, re.S).group(1)
head = re.sub(r'\s*<meta (charset|name="viewport")[^>]*>', "", head)
head = head.replace('<link rel="stylesheet" href="style.css">', "<style>\n" + (src / "style.css").read_text(encoding="utf-8") + "</style>")
head = head.replace("<title>", '<meta name="claude:viewport-fit-sides" content="cover">\n  <title>', 1)
for js in ("data.js", "app.js"):
    body = body.replace(f'<script src="{js}"></script>', "<script>\n" + (src / js).read_text(encoding="utf-8") + "</script>")
title = re.search(r"\s*<title>.*?</title>", head).group(0)
head = head.replace(title, "")
out.write_text(title.strip() + "\n" + head.strip() + "\n" + body.strip() + "\n", encoding="utf-8")
print(out, out.stat().st_size)
