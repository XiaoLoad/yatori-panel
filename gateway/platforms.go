package main

import (
	"sort"
	"time"

	yatori "github.com/yatori-dev/yatori-go-core"
)

// platformMeta 是网关对上游平台的静态元数据：驱动面板前端渲染
// 「添加账号」动态表单与能力展示。新增平台时在此补充描述。
type platformMeta struct {
	Key          string      `json:"key"`
	Name         string      `json:"name"`
	Capabilities []string    `json:"capabilities,omitempty"`
	LoginFields  []fieldSpec `json:"loginFields"`
	MVP          bool        `json:"mvp"` // 面板一期重点适配
}

type fieldSpec struct {
	Key         string `json:"key"`
	Label       string `json:"label"`
	Required    bool   `json:"required"`
	Secret      bool   `json:"secret"`
	Placeholder string `json:"placeholder,omitempty"`
}

func buildPlatformMeta() []platformMeta {
	registered := yatori.Registered()
	out := make([]platformMeta, 0, len(registered))
	for _, p := range registered {
		meta := platformMeta{
			Key: p.String(),
			Name: p.Description(),
			LoginFields: []fieldSpec{
				{Key: "username", Label: "账号", Required: true},
				{Key: "password", Label: "密码", Required: true, Secret: true},
			},
		}
		switch p {
		case yatori.YingHua:
			meta.Capabilities = []string{"login", "courses", "tree", "study", "works", "exams"}
			meta.LoginFields = append(meta.LoginFields, fieldSpec{
				Key: "url", Label: "学校平台地址", Required: true, Placeholder: "学校英华平台首页地址",
			})
			meta.MVP = true
		case yatori.XueXiTong:
			meta.Capabilities = []string{"login", "cookie-login", "courses", "tree", "study", "works", "exams"}
			meta.MVP = true
		}
		out = append(out, meta)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].MVP != out[j].MVP {
			return out[i].MVP
		}
		return out[i].Key < out[j].Key
	})
	return out
}

// ---------- 出参 DTO：抹平 time.Duration / Raw，保证前端拿到纯 JSON ----------

type courseDTO struct {
	ID       string            `json:"id"`
	Name     string            `json:"name"`
	Teacher  string            `json:"teacher"`
	Cover    string            `json:"cover"`
	Progress float64           `json:"progress"`
	Status   string            `json:"status"`
	Extra    map[string]string `json:"extra,omitempty"`
}

func dtoCourse(c yatori.Course) courseDTO {
	return courseDTO{
		ID: c.ID, Name: c.Name, Teacher: c.Teacher, Cover: c.Cover,
		Progress: c.Progress, Status: string(c.Status), Extra: c.Extra,
	}
}

type nodeDTO struct {
	ID              string            `json:"id"`
	ParentID        string            `json:"parentId,omitempty"`
	CourseID        string            `json:"courseId,omitempty"`
	Name            string            `json:"name"`
	Kind            string            `json:"kind"`
	DurationSeconds float64           `json:"durationSeconds"`
	Progress        float64           `json:"progress"`
	Completed       bool              `json:"completed"`
	Children        []nodeDTO         `json:"children"`
	Extra           map[string]string `json:"extra,omitempty"`
}

func dtoNode(n yatori.Node) nodeDTO {
	out := nodeDTO{
		ID: n.ID, ParentID: n.ParentID, CourseID: n.CourseID, Name: n.Name,
		Kind: string(n.Kind), DurationSeconds: n.Duration.Seconds(),
		Progress: n.Progress, Completed: n.Completed, Extra: n.Extra,
		Children: []nodeDTO{},
	}
	for _, child := range n.Children {
		out.Children = append(out.Children, dtoNode(child))
	}
	return out
}

type workDTO struct {
	ID            string            `json:"id"`
	CourseID      string            `json:"courseId"`
	Name          string            `json:"name"`
	Status        string            `json:"status"`
	Deadline      string            `json:"deadline,omitempty"`
	QuestionCount int               `json:"questionCount"`
	Extra         map[string]string `json:"extra,omitempty"`
}

func dtoWork(x yatori.Work) workDTO {
	deadline := ""
	if !x.Deadline.IsZero() {
		deadline = x.Deadline.Format(time.RFC3339)
	}
	return workDTO{
		ID: x.ID, CourseID: x.CourseID, Name: x.Name, Status: x.Status,
		Deadline: deadline, QuestionCount: x.QuestionCount, Extra: x.Extra,
	}
}

type examDTO struct {
	ID            string            `json:"id"`
	CourseID      string            `json:"courseId"`
	Name          string            `json:"name"`
	Status        string            `json:"status"`
	StartAt       string            `json:"startAt,omitempty"`
	EndAt         string            `json:"endAt,omitempty"`
	Duration      float64           `json:"durationSeconds"`
	QuestionCount int               `json:"questionCount"`
	Extra         map[string]string `json:"extra,omitempty"`
}

func dtoExam(x yatori.Exam) examDTO {
	start, end := "", ""
	if !x.StartAt.IsZero() {
		start = x.StartAt.Format(time.RFC3339)
	}
	if !x.EndAt.IsZero() {
		end = x.EndAt.Format(time.RFC3339)
	}
	return examDTO{
		ID: x.ID, CourseID: x.CourseID, Name: x.Name, Status: x.Status,
		StartAt: start, EndAt: end, Duration: x.Duration.Seconds(),
		QuestionCount: x.QuestionCount, Extra: x.Extra,
	}
}

type studyResultDTO struct {
	CourseID        string `json:"courseId"`
	NodeID          string `json:"nodeId"`
	Kind            string `json:"kind"`
	Submitted       bool   `json:"submitted"`
	PositionSeconds float64 `json:"positionSeconds"`
	Progress        float64 `json:"progress"`
	Completed       bool   `json:"completed"`
	Message         string `json:"message,omitempty"`
	Raw             any    `json:"raw,omitempty"`
}

func dtoStudyResult(r *yatori.StudyResult) studyResultDTO {
	return studyResultDTO{
		CourseID: r.CourseID, NodeID: r.NodeID, Kind: string(r.Kind),
		Submitted: r.Submitted, PositionSeconds: r.Position.Seconds(),
		Progress: r.Progress, Completed: r.Completed, Message: r.Message, Raw: r.Raw,
	}
}

type answerDTO struct {
	QuestionID string   `json:"questionId,omitempty"`
	Question   string   `json:"question,omitempty"`
	Type       string   `json:"type,omitempty"`
	Options    []string `json:"options,omitempty"`
	Value      []string `json:"value,omitempty"`
	Correct    bool     `json:"correct,omitempty"`
}

type answerResultDTO struct {
	TaskID    string      `json:"taskId"`
	Title     string      `json:"title"`
	Submitted bool        `json:"submitted"`
	Score     float64     `json:"score"`
	Answers   []answerDTO `json:"answers,omitempty"`
	Message   string      `json:"message,omitempty"`
	Raw       any         `json:"raw,omitempty"`
}

func dtoAnswerResult(r *yatori.AnswerResult) answerResultDTO {
	out := answerResultDTO{
		TaskID: r.TaskID, Title: r.Title, Submitted: r.Submitted,
		Score: r.Score, Message: r.Message, Raw: r.Raw, Answers: []answerDTO{},
	}
	for _, a := range r.Answers {
		out.Answers = append(out.Answers, answerDTO{
			QuestionID: a.QuestionID, Question: a.Question, Type: a.Type,
			Options: a.Options, Value: a.Value, Correct: a.Correct,
		})
	}
	return out
}

func secondsToDuration(s float64) time.Duration {
	if s <= 0 {
		return 0
	}
	return time.Duration(s * float64(time.Second))
}
