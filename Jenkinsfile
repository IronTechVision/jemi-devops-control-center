pipeline {
    agent any

    options {
        timeout(time: 15, unit: 'MINUTES')
        buildDiscarder(logRotator(numToKeepStr: '10'))
        ansiColor('xterm')
    }

    environment {
        PYTHONUNBUFFERED = '1'
        METRICS_DISK_PATH = '/'
    }

    stages {
        stage('Checkout') {
            steps {
                echo "Checking out source code on agent..."
                checkout scm
            }
        }

        stage('Environment Audit') {
            steps {
                script {
                    if (isUnix()) {
                        sh '''
                            echo "=== Linux/Unix Agent Detected ==="
                            uname -a
                            python3 --version || python --version
                        '''
                    } else {
                        bat '''
                            @echo off
                            echo === Windows Agent Detected ===
                            ver
                            python --version
                        '''
                    }
                }
            }
        }

        stage('Install Dependencies') {
            steps {
                script {
                    if (isUnix()) {
                        sh '''
                            python3 -m venv .jenkins_venv
                            . .jenkins_venv/bin/activate
                            pip install --upgrade pip
                            pip install -r requirements.txt
                        '''
                    } else {
                        bat '''
                            @echo off
                            python -m venv .jenkins_venv
                            call .jenkins_venv\\Scripts\\activate.bat
                            python -m pip install --upgrade pip
                            pip install -r requirements.txt
                        '''
                    }
                }
            }
        }

        stage('Run Automated Tests') {
            steps {
                script {
                    if (isUnix()) {
                        sh '''
                            . .jenkins_venv/bin/activate
                            python -m pytest tests/test_app.py --junitxml=reports/test-results.xml -v
                        '''
                    } else {
                        bat '''
                            @echo off
                            call .jenkins_venv\\Scripts\\activate.bat
                            python -m pytest tests/test_app.py --junitxml=reports/test-results.xml -v
                        '''
                    }
                }
            }
        }

        stage('Docker Image Build') {
            steps {
                script {
                    def dockerAvailable = false
                    if (isUnix()) {
                        dockerAvailable = (sh(script: 'command -v docker', returnStatus: true) == 0)
                    } else {
                        dockerAvailable = (bat(script: 'where docker', returnStatus: true) == 0)
                    }

                    if (dockerAvailable) {
                        echo "Docker detected on agent. Building container image..."
                        if (isUnix()) {
                            sh "docker build -t jemi-control-center:${BUILD_NUMBER} -t jemi-control-center:latest ."
                        } else {
                            bat "docker build -t jemi-control-center:%BUILD_NUMBER% -t jemi-control-center:latest ."
                        }
                    } else {
                        echo "Docker CLI not detected on this Jenkins agent. Skipping container build stage safely."
                    }
                }
            }
        }
    }

    post {
        always {
            // Publish JUnit XML test results if generated
            junit testResults: 'reports/test-results.xml', allowEmptyResults: true
        }
        success {
            echo "CI pipeline completed successfully for JEMI DevOps Control Center."
        }
        failure {
            echo "CI pipeline encountered test or build failures."
        }
        cleanup {
            // Clean up ephemeral virtual environment to preserve agent disk space
            script {
                if (isUnix()) {
                    sh 'rm -rf .jenkins_venv reports/'
                } else {
                    bat '''
                        @echo off
                        if exist .jenkins_venv rmdir /s /q .jenkins_venv
                        if exist reports rmdir /s /q reports
                    '''
                }
            }
        }
    }
}
