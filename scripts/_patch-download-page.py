# -*- coding: utf-8 -*-
"""One-shot patcher for download.html user-facing copy and NA2-aligned CSS."""
from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PAGE = ROOT / "download.html"

RELEASES = [
    {
        "version": "v0.1.20",
        "recommended": True,
        "status": "当前推荐",
        "summary": "点中间加号就能去做视频或复刻，不会再跳到「页面不存在」；拆解页上传视频也恢复成完整卡片。",
        "versionCode": "28",
        "size": "23,311,721 bytes",
        "sha256": "572D4901F3300615C6C85C3EDBAA766E3DF6E60A23C777DE0D1B08424F6FA0A8",
        "url": "https://husteread.com/storage/public/HongTai-AI-Agent-release-v0.1.20.apk",
    },
    {
        "version": "v0.1.19",
        "recommended": False,
        "status": "历史版本",
        "summary": "观察页按新界面重做；设置里可以开关通知、深色模式和清缓存。点赞播放量没有就不会编造。",
        "versionCode": "27",
        "size": "23,202,490 bytes",
        "sha256": "B47A95F68900804C43F15AB2472D598C1E78355BCE53F75A285DF68AA4AAEB1B",
        "url": "https://husteread.com/storage/public/HongTai-AI-Agent-release-v0.1.19.apk",
    },
    {
        "version": "v0.1.18",
        "recommended": False,
        "status": "历史版本",
        "summary": "制作页灰色按钮不再挡住微调和删除；选完素材再回来也不会一直转圈。数字人成片会带上原片声音。",
        "versionCode": "26",
        "size": "21,932,925 bytes",
        "sha256": "A5D39C07C62A37AF42F70242D17EB3F73C47E05E4BBEEA51759E5A3C931072CF",
        "url": "https://husteread.com/storage/public/HongTai-AI-Agent-release-v0.1.18.apk",
    },
    {
        "version": "v0.1.17",
        "recommended": False,
        "status": "历史版本",
        "summary": "做视频可以选智能成片或爆款复刻，还能换字幕样式、贴纸，并在微调页改口播、时长和背景音乐。",
        "versionCode": "25",
        "size": "21,932,117 bytes",
        "sha256": "1358DFA5D16FB6C4F25C2684E4A23B3773296167FE51069CE5B466A1A9212B53",
        "url": "https://husteread.com/storage/public/HongTai-AI-Agent-release-v0.1.17.apk",
    },
    {
        "version": "v0.1.16",
        "recommended": False,
        "status": "历史版本",
        "summary": "打开应用先看到品牌开屏；键盘弹出来时输入框会抬高。视频做好以后，不会又被改成失败。",
        "versionCode": "24",
        "size": "21,829,108 bytes",
        "sha256": "37580EEDF7587B0C1DF09FC43867DE4029CBF961D2A248E9A05232EC1027F8CA",
        "url": "https://husteread.com/storage/public/HongTai-AI-Agent-release-v0.1.16.apk",
    },
    {
        "version": "v0.1.15",
        "recommended": False,
        "status": "历史版本",
        "summary": "B 站公开链接可以拆到标题、封面和口播；拆完就能去做视频。限流或风控会说明下一步。",
        "versionCode": "23",
        "size": "28,989,075 bytes",
        "sha256": "75FD98F67918DEF783951B08DD4E5743C9DF6FA2C75A00E8C4C45F739E47E8C0",
        "url": "https://husteread.com/storage/public/HongTai-AI-Agent-release-v0.1.15.apk",
    },
    {
        "version": "v0.1.14",
        "recommended": False,
        "status": "历史版本",
        "summary": "拆解改成一个首页加一个任务页；制作页变成竖屏预览，底部只留一个会随步骤变化的按钮。",
        "versionCode": "22",
        "size": "28,986,082 bytes",
        "sha256": "D091EDCAA6B7F09CC3A2DB28364CD8C46719412364A7F03F1E010B12BA8E8579",
        "url": "https://husteread.com/storage/public/HongTai-AI-Agent-release-v0.1.14.apk",
    },
    {
        "version": "v0.1.13",
        "recommended": False,
        "status": "历史版本",
        "summary": "抖音图文也能采集了；失败或中断会说清楚，不会一直转圈。观察不会给出诊断、处方或概率。",
        "versionCode": "21",
        "size": "28,567,582 bytes",
        "sha256": "1C8AB9484245D75D6EE834716A32FBEBFA328B0C031CDF4C3C13B49D5FCB3C52",
        "url": "https://husteread.com/storage/public/HongTai-AI-Agent-release-v0.1.13.apk",
    },
    {
        "version": "v0.1.12",
        "recommended": False,
        "status": "历史版本",
        "summary": "清晰的舌象或面部照片会写出几条看得见的观察；传统方向只在特征凑得上时才给不确定参考。",
        "versionCode": "20",
        "size": "28,958,194 bytes",
        "sha256": "F48C3920113DFF48404F3C6454085AE4F30A7C79F8C0EA3F1334E6258FF408CE",
        "url": "https://husteread.com/storage/public/HongTai-AI-Agent-release-v0.1.12.apk",
    },
    {
        "version": "v0.1.11",
        "recommended": False,
        "status": "历史版本",
        "summary": "做视频可以加顶部大字和逐句字幕，也能选几种文字样式。口播会参考爆款思路，但不会整段照抄。",
        "versionCode": "19",
        "size": "28,955,602 bytes",
        "sha256": "79B0B8090C06D3384993334A89487BC2CA6E0A3CEDC9345195A11C0466DF2DBA",
        "url": "https://husteread.com/storage/public/HongTai-AI-Agent-release-v0.1.11.apk",
    },
    {
        "version": "v0.1.10",
        "recommended": False,
        "status": "历史版本",
        "summary": "桌面图标换成宏泰 AI 机器人图，并加上可以离线查看的富迪素材库。",
        "versionCode": "18",
        "size": "28,954,090 bytes",
        "sha256": "9A4B78BA7E75259E6809D04F42E6B73F9AD0E02524ED3EB6640B2126C3600C39",
        "url": "https://husteread.com/storage/public/HongTai-AI-Agent-release-v0.1.10.apk",
    },
    {
        "version": "v0.1.9",
        "recommended": False,
        "status": "历史版本",
        "summary": "观察报告增加传统望诊参考，依据公开标准和科普资料；仍然不是诊断，也不能代替医院。",
        "versionCode": "17",
        "size": "25,963,545 bytes",
        "sha256": "A98B1A608ED5C2C56C9015020588AC0D011A4FC9B12B9256799745B2AD31BC70",
        "url": "https://husteread.com/storage/public/HongTai-AI-Agent-release-v0.1.9.apk",
    },
    {
        "version": "v0.1.8",
        "recommended": False,
        "status": "历史版本",
        "summary": "本地视频听不清时会说清原因；没有人声会及时停下。页面改成普通人能看懂的说法。",
        "versionCode": "16",
        "size": "25,955,845 bytes",
        "sha256": "92CF32EE71174FA6941FBD6B765EE5BB1FE8C6DC87F24BD59ED967E05B9CAB17",
        "url": "https://husteread.com/storage/public/HongTai-AI-Agent-release-v0.1.8.apk",
    },
    {
        "version": "v0.1.7",
        "recommended": False,
        "status": "历史版本",
        "summary": "观察和拆解会边想边出结果，五个板块随进度出现，不用等到最后才看到。",
        "versionCode": "15",
        "size": "25,955,837 bytes",
        "sha256": "70A5A11074C94EB9DBC85708158C4E7A57C59AA0390F5D38AB4768A38509952A",
        "url": "https://husteread.com/storage/public/HongTai-AI-Agent-release-v0.1.7.apk",
    },
    {
        "version": "v0.1.6",
        "recommended": False,
        "status": "历史版本",
        "summary": "舌诊和面诊改成一次分析、分批展示，不用连问好几轮。上传自己的视频时页面也不会整页刷新。",
        "versionCode": "14",
        "size": "25,955,765 bytes",
        "sha256": "6575FA8C8AE14D557959233D9BE3A62B903A276B234D646B126C1D911093BEFE",
        "url": "https://husteread.com/storage/public/HongTai-AI-Agent-release-v0.1.6.apk",
    },
    {
        "version": "v0.1.5",
        "recommended": False,
        "status": "历史版本",
        "summary": "切到后台再回来，任务不会一直卡着；进行不下去会明确说已中断。相册仍然只读你选中的那一张。",
        "versionCode": "12",
        "size": "25,943,725 bytes",
        "sha256": "48D65860532BF1641222173BA42FFE479EA3180B3B75A146357EB44C25D1DE6D",
        "url": "https://husteread.com/storage/public/HongTai-AI-Agent-release-v0.1.5.apk",
    },
    {
        "version": "v0.1.4",
        "recommended": False,
        "status": "历史版本",
        "summary": "可以从手机里选视频做拆解，拆解结果能存成模板；素材、成片和整个项目也可以删掉。",
        "versionCode": "11",
        "size": "39,330,485 bytes",
        "sha256": "1E90709A622A804B81EF7E80CCD462F77BF5D66681A18D331B95077E841D43A9",
        "url": "https://husteread.com/storage/public/HongTai-AI-Agent-debug-v0.1.4.apk",
    },
    {
        "version": "v0.1.3",
        "recommended": False,
        "status": "历史版本",
        "summary": "修了部分华为手机打开应用就被拦住的问题，可以正常进入页面。",
        "versionCode": "10",
        "size": "39,068,134 bytes",
        "sha256": "AE536C5CF6620CB902CEA8D9A63B3CDDF3A7E884E26604C1C0272DAAEE9D0D16",
        "url": "https://husteread.com/storage/public/HongTai-AI-Agent-debug-v0.1.3-AE536C5CF662.apk",
    },
    {
        "version": "v0.1.2",
        "recommended": False,
        "status": "历史版本",
        "summary": "第一次使用可以一键配好 AI，做视频时也能选用云端语音旁白。",
        "url": "https://husteread.com/storage/public/HongTai-AI-Agent-debug-v0.1.2-E8FE0BF5A3AE.apk",
    },
    {
        "version": "v0.1.1",
        "recommended": False,
        "status": "历史版本",
        "summary": "把手机界面和系统朗读设置理顺，日常操作路径更清楚。",
        "url": "https://husteread.com/storage/public/HongTai-AI-Agent-debug-v0.1.1-15093BD71637.apk",
    },
]


def entry(
    iso: str,
    date: str,
    time: str,
    category: str,
    title: str,
    description: str,
    *,
    reference: str,
    url: str | None = None,
    download_label: str | None = None,
) -> dict:
    item = {
        "iso": iso,
        "date": date,
        "time": time,
        "category": category,
        "title": title,
        "description": description,
        "referenceLabel": reference,
    }
    if url:
        item["downloadUrl"] = url
        item["downloadLabel"] = download_label or "下载这个版本"
    return item


CHANGELOG = [
    entry(
        "2026-08-21T14:55:00+08:00",
        "2026.08.21",
        "当前推荐 · v0.1.20",
        "v0.1.20",
        "加号能进制作，上传视频也恢复成卡片",
        "点底栏中间加号，可以去做智能成片、爆款复刻或拆解新链接，不会再跳到「页面不存在」。拆解页「上传视频」重新做成完整卡片，图标和说明不再挤成一条。底栏加号变小、和左右入口对齐；观察采集卡加上扫光；模板页可以按名称搜索。",
        reference="当前推荐版本",
        url="https://husteread.com/storage/public/HongTai-AI-Agent-release-v0.1.20.apk",
        download_label="下载 v0.1.20",
    ),
    entry(
        "2026-08-21T10:25:48+08:00",
        "2026.08.21",
        "v0.1.19",
        "v0.1.19",
        "观察、设置和底栏按新界面重做",
        "观察起始页改叫「AI 诊断」，拍完确认才会开始分析。报告分区展示，页顶页底都有免责声明，不会给出确诊、概率、处方或健康评分。设置里可以开关通知、换深色或浅色、清缓存和看隐私说明。拆解详情有点赞播放量时才显示，没有就写「未解析到」，不会编造热度。",
        reference="历史版本",
        url="https://husteread.com/storage/public/HongTai-AI-Agent-release-v0.1.19.apk",
        download_label="下载 v0.1.19",
    ),
    entry(
        "2026-08-20T08:15:11+08:00",
        "2026.08.20",
        "v0.1.18",
        "v0.1.18",
        "制作页能点了，数字人成片也带原声",
        "制作页灰色主按钮不再挡住微调、删除和导入。从相册选完素材再回来，页面不会一直转圈。数字人合成会保留原片声音。卡住的规划或合成，在应用里换个页面就能停掉，不必关掉重开。",
        reference="历史版本",
        url="https://husteread.com/storage/public/HongTai-AI-Agent-release-v0.1.18.apk",
        download_label="下载 v0.1.18",
    ),
    entry(
        "2026-08-19T20:49:41+08:00",
        "2026.08.19",
        "v0.1.17",
        "v0.1.17",
        "做视频有两条路：智能成片和爆款复刻",
        "制作首页可以选智能成片或爆款复刻。成片可以换字幕样式、贴几个随包贴纸，也能逐句对字幕时间。做完还能进微调页改镜头、口播、语速和背景音乐；改完需要重新合成。复刻会先列出缺哪些素材，备齐后再合成。",
        reference="历史版本",
        url="https://husteread.com/storage/public/HongTai-AI-Agent-release-v0.1.17.apk",
        download_label="下载 v0.1.17",
    ),
    entry(
        "2026-08-18T14:50:00+08:00",
        "2026.08.18",
        "v0.1.16",
        "v0.1.16",
        "打开应用先看到开屏，键盘也不再挡住输入",
        "冷启动会先显示应用图标和浅色开屏。键盘弹出来时，输入框会抬高，不会被挡住。视频做好以后，不会又被改成失败。打开应用也更快一些。",
        reference="历史版本",
        url="https://husteread.com/storage/public/HongTai-AI-Agent-release-v0.1.16.apk",
        download_label="下载 v0.1.16",
    ),
    entry(
        "2026-08-18T08:05:00+08:00",
        "2026.08.18",
        "v0.1.15",
        "v0.1.15",
        "B 站公开链接可以拆解，拆完就能去做视频",
        "粘贴 B 站公开链接，可以采到标题、封面和口播。拆解成功后可以继续生成制作计划。遇到限流或风控会说明下一步，不会只报一个含糊错误。从拆解进入制作时，也不会把要做的那条弄丢。",
        reference="历史版本",
        url="https://husteread.com/storage/public/HongTai-AI-Agent-release-v0.1.15.apk",
        download_label="下载 v0.1.15",
    ),
    entry(
        "2026-08-17T10:20:00+08:00",
        "2026.08.17",
        "v0.1.14",
        "v0.1.14",
        "拆解和制作页重新排过，底栏回到五项",
        "拆解改成一个首页、一个任务页，原文和拆解左右分栏。制作页改成竖屏预览，底部只留一个会随步骤变化的主按钮。底栏回到观察、拆解、加号、模板、设置五项。桌面图标去掉白边。",
        reference="历史版本",
        url="https://husteread.com/storage/public/HongTai-AI-Agent-release-v0.1.14.apk",
        download_label="下载 v0.1.14",
    ),
    entry(
        "2026-08-17T02:30:00+08:00",
        "2026.08.17",
        "v0.1.13",
        "v0.1.13",
        "采集更稳，失败也不再假转圈",
        "抖音图文帖也能采集。内容私密或不存在时会说清楚。任务失败或中断会停在明确结果，不会一直转圈；做视频失败也不会删掉已经做好的成片。换任务、换项目时，屏幕只显示当前这一条。观察追问和报告都不会给出诊断、处方或概率。",
        reference="历史版本",
        url="https://husteread.com/storage/public/HongTai-AI-Agent-release-v0.1.13.apk",
        download_label="下载 v0.1.13",
    ),
    entry(
        "2026-08-15T16:38:38+08:00",
        "2026.08.15",
        "v0.1.12",
        "v0.1.12",
        "观察更细，也不会把一张图说成确诊",
        "清晰的舌象或面部照片，会写出几条互相独立的可见观察。照片稍微暗一点、偏一点，仍会看能看清的部分。传统方向只在特征凑得上时才给不确定参考，不会把齿痕直接说成「湿气重」。",
        reference="历史版本",
        url="https://husteread.com/storage/public/HongTai-AI-Agent-release-v0.1.12.apk",
        download_label="下载 v0.1.12",
    ),
    entry(
        "2026-08-15T01:49:06+08:00",
        "2026.08.15",
        "v0.1.11",
        "v0.1.11",
        "视频可以加顶部大字和逐句字幕",
        "做视频时可以自己填顶部主文字，也可以让 AI 根据需求写。每个镜头都能配底部短字幕，并有几种文字样式可选。口播会参考爆款思路，但不会整段照抄。",
        reference="历史版本",
        url="https://husteread.com/storage/public/HongTai-AI-Agent-release-v0.1.11.apk",
        download_label="下载 v0.1.11",
    ),
    entry(
        "2026-08-15T01:16:00+08:00",
        "2026.08.15",
        "v0.1.10",
        "v0.1.10",
        "换了应用图标，并加上富迪素材库",
        "桌面图标换成宏泰 AI 机器人图。页头可以打开富迪素材库，图片都打在安装包里，没有网也能看。",
        reference="历史版本",
        url="https://husteread.com/storage/public/HongTai-AI-Agent-release-v0.1.10.apk",
        download_label="下载 v0.1.10",
    ),
    entry(
        "2026-08-15T00:49:20+08:00",
        "2026.08.15",
        "v0.1.9",
        "v0.1.9",
        "观察报告增加传统望诊参考",
        "舌象和面诊会参考公开的国家标准、中医科普和教材，在照片看得清时给出不确定的传统方向。仍然不是诊断，也不能代替医院。",
        reference="历史版本",
        url="https://husteread.com/storage/public/HongTai-AI-Agent-release-v0.1.9.apk",
        download_label="下载 v0.1.9",
    ),
    entry(
        "2026-08-14T23:33:13+08:00",
        "2026.08.14",
        "v0.1.8",
        "v0.1.8",
        "拆解失败会说清原因，页面也不再满是术语",
        "本地视频听不清或识别失败时，会说明是网络、权限还是需要重新选视频。没有人声的视频会及时停下。首页、进度和设置改成普通人能看懂的说法。",
        reference="历史版本",
        url="https://husteread.com/storage/public/HongTai-AI-Agent-release-v0.1.8.apk",
        download_label="下载 v0.1.8",
    ),
    entry(
        "2026-08-13T20:35:41+08:00",
        "2026.08.13",
        "v0.1.7",
        "v0.1.7",
        "观察和拆解会边想边出结果",
        "分析过程会一段段显示出来，五个板块随进度出现，不用等到最后才看到。选完视频后页面不会整页刷新，把刚才的操作弄丢。",
        reference="历史版本",
        url="https://husteread.com/storage/public/HongTai-AI-Agent-release-v0.1.7.apk",
        download_label="下载 v0.1.7",
    ),
    entry(
        "2026-08-13T01:00:00+08:00",
        "2026.08.13",
        "v0.1.6",
        "v0.1.6",
        "一次分析就能看完推理过程",
        "舌诊和面诊不再连问五轮才出结果，改成一次生成、分批展示。上传自己的视频时，页面也不会被强制刷新。",
        reference="历史版本",
        url="https://husteread.com/storage/public/HongTai-AI-Agent-release-v0.1.6.apk",
        download_label="下载 v0.1.6",
    ),
    entry(
        "2026-08-12T20:51:46+08:00",
        "2026.08.12",
        "v0.1.5",
        "v0.1.5",
        "切到后台再回来，任务不会一直卡着",
        "应用被系统收回再打开，会重新核对任务状态。进行不下去的会明确说已中断，已经保存的资料还在。相册和相机仍然只读你选中的那一张，不申请整库权限。如果手机上还装着更早的调试版，需要先卸载再装这一版。",
        reference="历史版本",
        url="https://husteread.com/storage/public/HongTai-AI-Agent-release-v0.1.5.apk",
        download_label="下载 v0.1.5",
    ),
    entry(
        "2026-08-12",
        "2026.08.12",
        "v0.1.4",
        "v0.1.4",
        "可以从手机选视频拆解，也能自己管模板",
        "拆解支持直接选手机里的 MP4。拆解结果可以存成模板反复用；素材、成片和整个制作项目也可以删掉。",
        reference="历史版本",
        url="https://husteread.com/storage/public/HongTai-AI-Agent-debug-v0.1.4.apk",
        download_label="下载 v0.1.4",
    ),
    entry(
        "2026-08-11T15:56:16+08:00",
        "2026.08.11",
        "v0.1.3",
        "v0.1.3",
        "部分华为手机可以正常打开应用",
        "修了打开应用就被拦住进不去的问题，华为手机也能进入页面。",
        reference="历史版本",
        url="https://husteread.com/storage/public/HongTai-AI-Agent-debug-v0.1.3-AE536C5CF662.apk",
        download_label="下载 v0.1.3",
    ),
    entry(
        "2026-08-11T15:17:27+08:00",
        "2026.08.11",
        "v0.1.2",
        "v0.1.2",
        "一键配好 AI，视频也能用云端旁白",
        "减少第一次使用的配置步骤，做视频时可以选用云端语音旁白。",
        reference="历史版本",
        url="https://husteread.com/storage/public/HongTai-AI-Agent-debug-v0.1.2-E8FE0BF5A3AE.apk",
        download_label="下载 v0.1.2",
    ),
    entry(
        "2026-08-11T13:33:52+08:00",
        "2026.08.11",
        "v0.1.1",
        "v0.1.1",
        "把手机界面和系统朗读设置理顺",
        "收紧安全区和设置页细节，系统语音朗读入口更容易找到。",
        reference="历史版本",
        url="https://husteread.com/storage/public/HongTai-AI-Agent-debug-v0.1.1-15093BD71637.apk",
        download_label="下载 v0.1.1",
    ),
    entry(
        "2026-08-10T23:37:24+08:00",
        "2026.08.10",
        "早期打磨",
        "早期能力",
        "做视频失败时，已经做好的成片还在",
        "改进配音、字幕和竖屏合成。做到一半失败时，上一版已经做好的成片不会被删掉。",
        reference="早期记录",
    ),
    entry(
        "2026-08-10T00:06:50+08:00",
        "2026.08.10",
        "早期打磨",
        "早期能力",
        "较老的安卓手机也能打开 HEIF 照片",
        "Android 7 一类较老的手机，导入 HEIF 照片时不再直接打不开。",
        reference="早期记录",
    ),
    entry(
        "2026-08-09T02:52:40+08:00",
        "2026.08.09",
        "早期打磨",
        "早期能力",
        "相册选图失败后，不会卡住后续操作",
        "从相册选图失败或取消后，会把这次选择收干净，下次还能正常再选。",
        reference="早期记录",
    ),
    entry(
        "2026-08-09T00:42:19+08:00",
        "2026.08.09",
        "早期打磨",
        "早期能力",
        "链接打不开时会说清是网络还是证书问题",
        "粘贴的公开链接打不开时，会区分连不上、证书不对还是超时，同时不会把链接里的敏感参数显示出来。",
        reference="早期记录",
    ),
    entry(
        "2026-08-09",
        "2026.07.31 — 2026.08.09",
        "首版成形",
        "从零到能用",
        "连续打磨十天，做出第一版能装进手机的工具",
        "这是一套帮门店和内容团队做事的手机工具：可以保存门店与个人资料，连接自己选择的 AI 服务；粘贴抖音、小红书、B 站等公开内容，整理视频、图片和文字；把一条内容拆成主题、受众和可执行思路；上传舌象或面部照片，获得仅供日常参考的可见观察；选择手机里的图片和视频，在本机完成配音、字幕和竖屏成片。资料优先保存在自己的手机里，不依赖账号登录和云端同步。",
        reference="最早的公开原型",
    ),
]


def to_js_const(name: str, value: object) -> str:
    dumped = json.dumps(value, ensure_ascii=False, indent=2)
    indented = "\n".join(f"    {line}" if line else line for line in dumped.splitlines())
    return f"    const {name} = {indented.lstrip()};\n"


def replace_between(text: str, start: str, end: str, replacement: str) -> str:
    start_at = text.index(start)
    end_at = text.index(end, start_at)
    return text[:start_at] + replacement + text[end_at:]


def noscript_block() -> str:
    latest, *older = RELEASES
    cards = []
    for item in older:
        cards.append(
            "\n".join(
                [
                    "                <article class=\"release-card\">",
                    f"                  <div class=\"release-card__top\"><strong class=\"release-card__version\">{item['version']}</strong><span class=\"badge\">历史版本</span></div>",
                    f"                  <p class=\"release-card__summary\">{item['summary']}</p>",
                    f"                  <a class=\"release-card__link\" href=\"{item['url']}\">下载安装包 <span aria-hidden=\"true\">↓</span></a>",
                    "                </article>",
                ]
            )
        )
    inner = "\n".join(cards)
    return f"""        <noscript>
          <div class="release-list">
            <article class="release-card release-card--recommended">
              <div class="release-card__top"><strong class="release-card__version">{latest['version']}</strong><span class="badge">当前推荐</span></div>
              <p class="release-card__summary">{latest['summary']}</p>
              <a class="release-card__link" href="{latest['url']}">下载安装包 <span aria-hidden="true">↓</span></a>
            </article>
            <details class="release-archive">
              <summary class="release-archive__summary">历史版本 <span class="release-archive__count">{len(older)} 个可下载版本</span></summary>
              <div class="release-archive__content">
{inner}
              </div>
            </details>
          </div>
        </noscript>
"""


def patch_css(text: str) -> str:
    text = text.replace(
        '<meta name="theme-color" content="#f4f7f2">',
        '<meta name="theme-color" content="#ffffff">',
    )
    text = text.replace(
        '<meta name="description" content="宏泰 AI 智能体 Android 测试版本下载与更新记录。">',
        '<meta name="description" content="宏泰 AI 智能体 Android 安装包下载与更新记录。">',
    )
    text = replace_between(
        text,
        "      --paper:",
        "      --brand-mark-image:",
        """      --paper: #ffffff;
      --paper-deep: #fbfdfa;
      --surface: #e6f7f1;
      --surface-hover: #d7f4ea;
      --surface-active: #c7eedf;
      --ink: #1b1d1f;
      --muted: #5f646a;
      --line: #eeefed;
      --green: #10b981;
      --green-deep: #0c8a66;
      --mint: #10b981;
      --lime: #e6f7f1;
      --white: #ffffff;
      --shadow: 0 0.1875rem 0.5rem rgba(16, 185, 129, 0.18);
      --ease: cubic-bezier(0.2, 0, 0, 1);
      --display: "Noto Sans SC", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
      --body: "Noto Sans SC", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
      """,
    )
    text = text.replace(
        """      background:
        radial-gradient(circle at 90% 3%, rgba(86, 186, 159, 0.09), transparent 27rem),
        radial-gradient(circle at 3% 28%, rgba(195, 233, 210, 0.24), transparent 24rem),
        var(--paper);""",
        """      background:
        radial-gradient(circle at 88% 0%, rgba(16, 185, 129, 0.08), transparent 22rem),
        radial-gradient(circle at 0% 28%, rgba(230, 247, 241, 0.85), transparent 18rem),
        var(--paper);""",
    )
    text = text.replace("      opacity: 0.3;", "      opacity: 0.16;", 1)
    text = text.replace(
        """      min-height: 52px;
      padding: 0 23px;
      border: 1px solid transparent;
      border-radius: 999px;
      font-weight: 800;
      letter-spacing: 0.02em;
      text-decoration: none;
      transition: transform 180ms ease, box-shadow 180ms ease, background-color 180ms ease;""",
        """      min-height: 44px;
      padding: 0 20px;
      border: 1px solid transparent;
      border-radius: 12px;
      font-weight: 700;
      letter-spacing: 0.01em;
      text-decoration: none;
      transition: transform 220ms var(--ease), background-color 220ms var(--ease);""",
    )
    text = text.replace(".button:hover { transform: translateY(-3px); }", ".button:hover { transform: scale(0.98); }")
    text = text.replace(
        """    .button--primary {
      color: var(--green-deep);
      border-color: rgba(32, 131, 104, 0.2);
      background: var(--surface-hover);
      box-shadow: 0 14px 30px rgba(54, 112, 91, 0.1);
    }

    .button--primary:hover {
      background: var(--surface-active);
      box-shadow: 0 18px 38px rgba(54, 112, 91, 0.14);
    }""",
        """    .button--primary {
      color: var(--white);
      background: var(--green);
      box-shadow: var(--shadow);
    }

    .button--primary:hover {
      background: var(--green-deep);
    }""",
    )
    text = text.replace(
        """      color: var(--white);
      background: var(--mint);""",
        """      color: var(--white);
      background: rgba(255, 255, 255, 0.22);""",
    )
    text = text.replace(
        """      border: 1px solid rgba(255, 255, 255, 0.8);
      border-radius: 32px;
      background:
        linear-gradient(145deg, rgba(255,255,255,0.96), rgba(230,247,237,0.8));
      box-shadow: var(--shadow);""",
        """      border: 1px solid var(--line);
      border-radius: 16px;
      background: var(--paper-deep);
      box-shadow: none;""",
    )
    text = text.replace(
        "background: radial-gradient(circle at 38% 38%, rgba(214,241,225,0.96), rgba(139,206,182,0.28) 46%, transparent 72%);",
        "background: radial-gradient(circle at 38% 38%, rgba(230,247,241,0.95), rgba(16,185,129,0.12) 46%, transparent 72%);",
    )
    text = text.replace(
        """      border: 1px solid rgba(8, 121, 102, 0.15);
      border-radius: 50%;
      content: "";
      box-shadow: 0 0 0 38px rgba(8,121,102,0.035), 0 0 0 76px rgba(8,121,102,0.025);""",
        """      border: 1px solid rgba(16, 185, 129, 0.12);
      border-radius: 50%;
      content: "";
      box-shadow: 0 0 0 28px rgba(16,185,129,0.04);""",
    )
    text = text.replace(
        """      border-radius: 20px;
      background: var(--white) var(--brand-mark-image) center / cover no-repeat;
      box-shadow: 0 20px 40px rgba(5,89,76,0.14);
      transform: rotate(-3deg);""",
        """      border-radius: 12px;
      background: var(--white) var(--brand-mark-image) center / cover no-repeat;
      box-shadow: var(--shadow);
      transform: none;""",
    )
    text = text.replace(
        """      color: #42544f;
      font-size: clamp(16px, 1.25vw, 18px);""",
        """      color: var(--muted);
      font-size: clamp(15px, 1.25vw, 16px);""",
    )
    text = text.replace(
        """      font-weight: 900;
      letter-spacing: 0.2em;
      text-transform: uppercase;""",
        """      font-weight: 700;
      letter-spacing: 0.08em;""",
    )
    text = text.replace(
        """      border-radius: 24px;
      background: rgba(255, 255, 255, 0.78);""",
        """      border-radius: 16px;
      background: var(--white);""",
    )
    text = text.replace(
        """    .release-card:hover {
      border-color: rgba(8, 121, 102, 0.28);
      box-shadow: 0 24px 60px rgba(17,56,48,0.09);
      transform: translateY(-5px);
    }""",
        """    .release-card:hover {
      border-color: rgba(16, 185, 129, 0.28);
      box-shadow: var(--shadow);
      transform: translateY(-2px);
    }""",
    )
    text = text.replace(
        """    .release-card--recommended {
      color: var(--ink);
      border-color: rgba(86, 186, 159, 0.26);
      background:
        radial-gradient(circle at 100% 0%, rgba(195,233,210,0.62), transparent 44%),
        linear-gradient(145deg, #f4fbf7, #e6f7ed);
      box-shadow: 0 22px 54px rgba(54,112,91,0.09);
    }""",
        """    .release-card--recommended {
      color: var(--ink);
      border-color: transparent;
      background: var(--surface);
      box-shadow: none;
    }""",
    )
    text = text.replace(
        """      border-radius: 20px;
      background: rgba(255,255,255,0.56);""",
        """      border-radius: 16px;
      background: var(--paper-deep);""",
    )
    text = text.replace(
        """      border: 1px solid rgba(167, 118, 19, 0.16);
      border-radius: 18px;
      color: #755414;
      background: rgba(255, 244, 204, 0.5);""",
        """      border: 1px solid #f3e0c4;
      border-radius: 16px;
      color: #a8650a;
      background: #ffedd5;""",
    )
    text = text.replace(".release-boundary strong { color: #503706; }", ".release-boundary strong { color: #1b1d1f; }")
    text = text.replace(
        """      transform: translateY(22px);
      transition: opacity 620ms ease, transform 620ms cubic-bezier(.2,.75,.25,1);""",
        """      transform: translateY(16px);
      transition: opacity 480ms var(--ease), transform 480ms var(--ease);""",
    )
    text = text.replace(
        "animation: enter 720ms both cubic-bezier(.2,.75,.25,1);",
        "animation: enter 480ms both var(--ease);",
    )
    return text


def patch_html_copy(text: str) -> str:
    text = text.replace(
        """        <p class="eyebrow">Android Download Center</p>
        <h1 id="hero-title">让内容开始<span class="hero__accent">流动。</span></h1>
        <p class="hero__lead">宏泰 AI 智能体把公开内容采集、AI 拆解、图片观察与本地视频制作，收进一台 Android 设备。这里提供正式版本下载与真实更新记录。</p>
        <div class="hero__actions">
          <a class="button button--primary" href="https://husteread.com/storage/public/HongTai-AI-Agent-release-v0.1.20.apk" aria-label="下载宏泰 AI 智能体 v0.1.20 Android 正式签名版">
            下载 v0.1.20
            <span class="button__arrow" aria-hidden="true">↓</span>
          </a>
          <span class="version-note">正式签名 Release · Android APK</span>
        </div>""",
        """        <p class="eyebrow">当前推荐安装包</p>
        <h1 id="hero-title">让 AI 帮你把内容<span class="hero__accent">做好。</span></h1>
        <p class="hero__lead">把公开内容采集、AI 拆解、图片观察和本地做视频，收进一台安卓手机。这里提供安装包下载，以及每个版本真正改了什么。</p>
        <div class="hero__actions">
          <a class="button button--primary" href="https://husteread.com/storage/public/HongTai-AI-Agent-release-v0.1.20.apk" aria-label="下载宏泰 AI 智能体 v0.1.20 Android 安装包">
            下载 v0.1.20
            <span class="button__arrow" aria-hidden="true">↓</span>
          </a>
          <span class="version-note">Android 安装包</span>
        </div>""",
    )
    text = text.replace(
        """          <span class="release-object__status">Latest build</span>
          <span class="release-object__stamp">UPDATED 2026.08.21</span>""",
        """          <span class="release-object__status">当前版本</span>
          <span class="release-object__stamp">2026.08.21</span>""",
    )
    text = text.replace(
        """                <strong>加号入口 · 上传整卡</strong>
                <span>正式签名 Release</span>""",
        """                <strong>加号能进制作</strong>
                <span>拆解上传也恢复成卡片</span>""",
    )
    text = text.replace(
        """            <p class="kicker">Version Archive</p>
            <h2 id="downloads-title">选择适合你的版本</h2>
          </div>
          <p class="section-intro">新版本优先呈现，旧版本继续保留。以后新增或删除版本，只需维护页面脚本顶部的数据列表。</p>""",
        """            <p class="kicker">安装包</p>
            <h2 id="downloads-title">选择适合你的版本</h2>
          </div>
          <p class="section-intro">新版本放在最上面，旧版本仍然可以下载。安装包大小和校验码写在卡片上，方便你核对下到的是不是同一份文件。</p>""",
    )
    text = text.replace(
        """            <p class="kicker">Product Pulse</p>
            <h2 id="changelog-title">每一次修复，都有迹可循。</h2>""",
        """            <p class="kicker">更新记录</p>
            <h2 id="changelog-title">这个版本改了什么</h2>""",
    )
    text = text.replace(
        """          <div><strong>版本说明：</strong>v0.1.20 使用 versionCode 28，公网文件为 23,311,721 字节、SHA-256 572D4901F3300615C6C85C3EDBAA766E3DF6E60A23C777DE0D1B08424F6FA0A8，已与本地 Release 归档重新下载核对一致。尚未使用真实 AI Provider 分析真实照片，也未完成物理 Android 真机端测。</div>""",
        """          <div><strong>使用说明：</strong>当前推荐 v0.1.20。安装包大小和校验码写在下载卡片上。观察和成片请在自己的手机上试用；本页不会假装已经替你验收过。</div>""",
    )
    text = text.replace(
        '<div class="footer-meta">Android 测试版本下载页 · 内容更新于 2026-08-21</div>',
        '<div class="footer-meta">Android 安装包下载 · 内容更新于 2026-08-21</div>',
    )
    text = text.replace('<span class="platform-pill">ANDROID</span>', '<span class="platform-pill">安卓</span>')
    return text


def patch_js_helpers(text: str) -> str:
    text = text.replace(
        'top.append(createElement("span", "badge", latest ? "最新版本" : release.status));',
        'top.append(createElement("span", "badge", latest ? "当前推荐" : release.status));',
    )
    text = text.replace(
        'if (release.versionCode) facts.append(createElement("span", "release-card__fact", `versionCode ${release.versionCode}`));',
        'if (release.versionCode) facts.append(createElement("span", "release-card__fact", `内部版本 ${release.versionCode}`));',
    )
    text = text.replace(
        """      link.setAttribute("aria-label", `下载宏泰 AI 智能体 ${release.version} Android 测试版`);
      link.append(createElement("span", "", `定向下载 ${release.version} Android APK`));""",
        """      link.setAttribute("aria-label", `下载宏泰 AI 智能体 ${release.version} Android 安装包`);
      link.append(createElement("span", "", `下载 ${release.version}`));""",
    )
    text = text.replace(
        """        const download = createElement("a", "commit-ref", entry.downloadLabel || "下载端测 APK");
        download.href = entry.downloadUrl;
        download.setAttribute("aria-label", `${entry.downloadLabel || "下载端测 APK"}，不是普通用户安装包`);""",
        """        const download = createElement("a", "commit-ref", entry.downloadLabel || "下载这个版本");
        download.href = entry.downloadUrl;
        download.setAttribute("aria-label", entry.downloadLabel || "下载这个版本");""",
    )
    return text


def main() -> None:
    text = PAGE.read_text(encoding="utf-8")
    text = patch_css(text)
    text = patch_html_copy(text)
    text = patch_js_helpers(text)

    releases_js = to_js_const("RELEASES", RELEASES)
    changelog_js = to_js_const("CHANGELOG", CHANGELOG)
    text = replace_between(
        text,
        "    const RELEASES = [",
        "    // 更新维护区：所有时间统一使用北京时间（UTC+8）。",
        releases_js + "\n",
    )
    text = replace_between(
        text,
        "    const CHANGELOG = [",
        "    function createElement(tag, className, text) {",
        changelog_js + "\n",
    )
    text = replace_between(
        text,
        "        <noscript>",
        "        <div class=\"release-boundary reveal\" role=\"note\">",
        noscript_block() + "\n",
    )

    PAGE.write_text(text, encoding="utf-8")
    forbidden = [
        "进入正式签名版本",
        "公网哈希已回验",
        "批次 6 已合入",
        "正式签名 Release",
        "未归档稿",
        "定向下载",
    ]
    for phrase in forbidden:
        if phrase in text:
            raise SystemExit(f"forbidden phrase still present: {phrase}")
    print("patched", PAGE, "changelog entries", len(CHANGELOG), "releases", len(RELEASES))


if __name__ == "__main__":
    main()
