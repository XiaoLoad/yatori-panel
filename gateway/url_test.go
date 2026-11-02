package main

import "testing"

func TestNormalizeAccountURL(t *testing.T) {
	cases := []struct {
		name     string
		platform string
		raw      string
		want     string
	}{
		{"英华带 /user", "YINGHUA", "https://cqucc.xinghanjjkj.com/user", "https://cqucc.xinghanjjkj.com"},
		{"英华带 /user/ 与参数", "YINGHUA", "https://host:8443/user/?from=login#top", "https://host:8443"},
		{"英华仅主机", "YINGHUA", "https://host", "https://host"},
		{"英华缺协议", "YINGHUA", "host/user", "https://host"},
		{"英华保留 http", "YINGHUA", "http://host/user", "http://host"},
		{"其他平台保留路径", "ICVE", "https://host/edu/", "https://host/edu"},
		{"空地址", "YINGHUA", "  ", ""},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := normalizeAccountURL(c.platform, c.raw); got != c.want {
				t.Fatalf("normalizeAccountURL(%q, %q) = %q, want %q", c.platform, c.raw, got, c.want)
			}
		})
	}
}
