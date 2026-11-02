package main

import (
	"net/url"
	"strings"
)

// normalizeAccountURL 归一化平台地址：用户常把登录页完整地址粘贴进来
// （如 https://host/user），而英华 SDK 以根路径拼接 /user/login.json 与
// /api/*，带路径会全部 404。英华只保留协议 + 主机（含端口）；其他平台
// 保留路径，仅去掉结尾斜杠与查询参数。
func normalizeAccountURL(platform, raw string) string {
	s := strings.TrimSpace(raw)
	if s == "" {
		return ""
	}
	if !strings.Contains(s, "://") {
		s = "https://" + s
	}
	u, err := url.Parse(s)
	if err != nil || u.Host == "" {
		return s
	}
	if strings.EqualFold(platform, "YINGHUA") {
		return u.Scheme + "://" + u.Host
	}
	u.RawQuery = ""
	u.Fragment = ""
	u.Path = strings.TrimRight(u.Path, "/")
	return u.String()
}
