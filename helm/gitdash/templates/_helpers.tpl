{{/*
Expand the name of the chart.
*/}}
{{- define "gitdash.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
*/}}
{{- define "gitdash.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Chart label.
*/}}
{{- define "gitdash.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels applied to every resource.
*/}}
{{- define "gitdash.labels" -}}
helm.sh/chart: {{ include "gitdash.chart" . }}
{{ include "gitdash.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
Selector labels — used by Deployment selector and Service selector.
*/}}
{{- define "gitdash.selectorLabels" -}}
app.kubernetes.io/name: {{ include "gitdash.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
The namespace to deploy into (supports namespaceOverride).
*/}}
{{- define "gitdash.namespace" -}}
{{- if .Values.namespaceOverride }}
{{- .Values.namespaceOverride }}
{{- else }}
{{- .Release.Namespace }}
{{- end }}
{{- end }}

{{/*
The image reference: repository:tag (tag defaults to appVersion).
*/}}
{{- define "gitdash.image" -}}
{{- $tag := .Values.image.tag | default .Chart.AppVersion }}
{{- printf "%s:%s" .Values.image.repository $tag }}
{{- end }}

{{/*
Name of the Secret that holds SESSION_SECRET etc.
*/}}
{{- define "gitdash.secretName" -}}
{{- if .Values.secret.create }}
{{- include "gitdash.fullname" . }}
{{- else }}
{{- required "secret.existingSecretName must be set when secret.create is false" .Values.secret.existingSecretName }}
{{- end }}
{{- end }}

{{/*
Name of the ConfigMap.
*/}}
{{- define "gitdash.configmapName" -}}
{{- printf "%s-config" (include "gitdash.fullname" .) }}
{{- end }}

{{/*
Service account name.
*/}}
{{- define "gitdash.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "gitdash.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}
